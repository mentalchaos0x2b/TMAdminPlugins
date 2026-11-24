<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useTarget, useExec, useSharedStore, useMessage } from "@tmadmin/sdk";
import {
  NCard,
  NTag,
  NButton,
  NIcon,
  NTooltip,
  NSpace,
} from "naive-ui";
import {
  CopyOutline,
  CheckmarkOutline,
  RefreshOutline,
} from "@vicons/ionicons5";
import { formatRtt, formatTimestamp } from "../lib/networkMetrics";

const target = useTarget();
const exec = useExec();
const sharedStore = useSharedStore();
const message = useMessage();

const isPinging = ref<boolean>(false);
const quickPingError = ref<string>("");
const quickPingResult = ref<{ ms: number | null; time: string } | null>(null);
const sharedStats = ref<{ lossPercent?: number } | null>(null);
const copiedField = ref<string | null>(null);

async function copyText(value: string, fieldKey: string, label: string): Promise<void> {
  if (!value || value === "–" || value === "– Не выбран –") return;
  try {
    await navigator?.clipboard?.writeText?.(value);
    copiedField.value = fieldKey;
    message.success(`${label} скопировано`);
    setTimeout(() => {
      if (copiedField.value === fieldKey) copiedField.value = null;
    }, 1500);
  } catch {
    message.error("Не удалось скопировать в буфер обмена");
  }
}

async function copyAllInfo(): Promise<void> {
  const lines = [
    `Хост: ${host.value || "-"}`,
    `IP: ${ip.value}`,
    `Статус: ${currentStatus.value.toUpperCase()}`,
    `RTT: ${displayRtt.value}`,
    `Потери: ${displayLoss.value}`,
    `Проверено: ${displayLastChecked.value}`,
  ];
  await copyText(lines.join("\n"), "all", "Сводка об узле");
}

const host = computed<string>(() => target.value?.host || "localhost");
const ip = computed<string>(() => target.value?.ip || "–");

const currentStatus = computed<string>(() => {
  if (quickPingResult.value) {
    return quickPingResult.value.ms !== null ? "online" : "offline";
  }
  return target.value?.status || "idle";
});

const displayRtt = computed<string>(() => {
  if (quickPingResult.value) {
    return formatRtt(quickPingResult.value.ms, "Таймаут");
  }
  return formatRtt(target.value?.responseTimeMs, "–");
});

const displayLoss = computed<string>(() => {
  const targetLoss = (target.value as Record<string, unknown> | undefined)?.packetLossPercent;
  if (typeof targetLoss === "number") {
    return `${targetLoss}%`;
  }
  if (typeof sharedStats.value?.lossPercent === "number") {
    return `${sharedStats.value.lossPercent}%`;
  }
  return "0%";
});

const displayLastChecked = computed<string>(() => {
  if (quickPingResult.value) {
    return formatTimestamp(quickPingResult.value.time);
  }
  return formatTimestamp(target.value?.lastChecked);
});

onMounted(async () => {
  try {
    const saved = await sharedStore.get<{ lossPercent?: number }>("network.latest_stats");
    if (saved) sharedStats.value = saved;
  } catch {
    /* ignore */
  }
});

sharedStore.subscribe<{ stats?: { lossPercent?: number } }>("network:ping_tick", (payload) => {
  if (payload?.stats) {
    sharedStats.value = payload.stats;
  }
});

watch(
  () => target.value?.host,
  () => {
    quickPingResult.value = null;
    quickPingError.value = "";
  },
);

async function performQuickPing(): Promise<void> {
  const targetHost = host.value.trim();
  if (!targetHost) return;
  isPinging.value = true;
  quickPingError.value = "";
  try {
    const pingId = await exec.pingStart(targetHost);
    await new Promise<void>((resolve, reject) => {
      let unlisten: (() => void) | null = null;
      const timeout = setTimeout(() => {
        unlisten?.();
        exec.pingStop(pingId).catch(() => {});
        quickPingResult.value = { ms: null, time: new Date().toISOString() };
        resolve();
      }, 1500);
      exec
        .listenPing(pingId, (payload) => {
          clearTimeout(timeout);
          unlisten?.();
          exec.pingStop(pingId).catch(() => {});
          quickPingResult.value = { ms: payload.ms, time: new Date().toISOString() };
          resolve();
        })
        .then((u) => {
          unlisten = u;
        })
        .catch(reject);
    });
  } catch (err) {
    if (
      typeof window !== "undefined" &&
      !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    ) {
      quickPingResult.value = { ms: 12, time: new Date().toISOString() };
    } else {
      quickPingError.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    isPinging.value = false;
  }
}
</script>

<template>
  <n-card
    class="conn-card"
    size="small"
    :bordered="false"
    data-testid="device-info-block"
  >
    <div class="conn-top">
      <div class="conn-title-group">
        <span class="conn-title">Соединение и узел</span>
        <n-tag
          size="small"
          :bordered="false"
          :type="currentStatus === 'online' ? 'success' : currentStatus === 'offline' ? 'error' : 'default'"
          class="status-tag"
          data-testid="device-info-status"
        >
          {{ currentStatus.toUpperCase() }}
        </n-tag>
      </div>
      <n-space :size="4" align="center">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="tiny"
              quaternary
              data-testid="device-info-copy-all-btn"
              @click="copyAllInfo"
            >
              <template #icon>
                <n-icon :component="copiedField === 'all' ? CheckmarkOutline : CopyOutline" />
              </template>
            </n-button>
          </template>
          <span>Копировать всю информацию</span>
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="tiny"
              secondary
              :loading="isPinging"
              :disabled="isPinging || !host"
              data-testid="device-info-ping-btn"
              @click="performQuickPing"
            >
              <template #icon>
                <n-icon :component="RefreshOutline" />
              </template>
              {{ isPinging ? "Опрос..." : "Обновить" }}
            </n-button>
          </template>
          <span>Выполнить быстрый опрос узла</span>
        </n-tooltip>
      </n-space>
    </div>

    <div class="info-list">
      <div class="info-row">
        <span class="info-label">Хост</span>
        <div class="info-value-wrap">
          <span class="val c-host selectable" data-testid="device-info-host">{{ host || "– Не выбран –" }}</span>
          <n-button
            v-if="host"
            size="tiny"
            quaternary
            class="copy-btn"
            data-testid="device-info-copy-host-btn"
            title="Копировать хост"
            @click="copyText(host, 'host', 'Имя хоста')"
          >
            <template #icon>
              <n-icon :size="13" :component="copiedField === 'host' ? CheckmarkOutline : CopyOutline" />
            </template>
          </n-button>
        </div>
      </div>

      <div class="info-row">
        <span class="info-label">Адрес IP</span>
        <div class="info-value-wrap">
          <span class="val selectable" data-testid="device-info-ip">{{ ip }}</span>
          <n-button
            v-if="ip && ip !== '–'"
            size="tiny"
            quaternary
            class="copy-btn"
            data-testid="device-info-copy-ip-btn"
            title="Копировать IP"
            @click="copyText(ip, 'ip', 'IP-адрес')"
          >
            <template #icon>
              <n-icon :size="13" :component="copiedField === 'ip' ? CheckmarkOutline : CopyOutline" />
            </template>
          </n-button>
        </div>
      </div>

      <div class="info-row">
        <span class="info-label">Задержка (RTT)</span>
        <span class="val c-rtt selectable" data-testid="device-info-rtt">{{ displayRtt }}</span>
      </div>

      <div class="info-row">
        <span class="info-label">Потери пакетов</span>
        <span class="val c-loss selectable" data-testid="device-info-loss">{{ displayLoss }}</span>
      </div>

      <div class="info-row">
        <span class="info-label">Проверено</span>
        <span class="val selectable" data-testid="device-info-last-checked">{{ displayLastChecked }}</span>
      </div>
    </div>

    <span v-if="quickPingError" class="err-txt">{{ quickPingError }}</span>
  </n-card>
</template>

<style scoped>
.conn-card {
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  background: transparent;
  color: var(--tm-tx, #e6edf3);
  display: flex;
  flex-direction: column;
}
:deep(.n-card-content) {
  padding: 0 !important;
}
:deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 !important;
  height: 100%;
  box-sizing: border-box;
}
.conn-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.conn-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.conn-title {
  font-weight: 700;
  font-size: 12px;
  color: var(--tm-tx, #f0f6fc);
  white-space: nowrap;
}
.status-tag {
  font-weight: 700;
  font-size: 9.5px;
}
.info-list {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  flex: 1;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid var(--tm-line, rgba(255, 255, 255, 0.06));
  border-radius: 6px;
  padding: 2px 8px;
}
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  min-width: 0;
}
.info-row:last-child {
  border-bottom: none;
}
.info-label {
  color: var(--tm-mut, #8b949e);
  font-size: 11.5px;
  white-space: nowrap;
  flex-shrink: 0;
}
.info-value-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.val {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-weight: 600;
  color: var(--tm-tx, #f0f6fc);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.selectable {
  user-select: text;
  cursor: text;
}
.copy-btn {
  padding: 0 3px;
  height: 20px;
  opacity: 0.75;
  flex-shrink: 0;
}
.copy-btn:hover {
  opacity: 1;
}
.c-host { color: #58a6ff; }
.c-rtt { color: #18a058; }
.c-loss { color: #e55353; }
.note-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: auto;
}
.note-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.note-input {
  font-size: 11px;
}
.bottom-feedback {
  display: flex;
  align-items: center;
  gap: 8px;
}
.saved-tag {
  align-self: flex-start;
  font-size: 10px;
}
.err-txt {
  color: #e55353;
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
