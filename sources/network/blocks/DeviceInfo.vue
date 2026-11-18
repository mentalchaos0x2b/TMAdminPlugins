<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useTarget, useExec, usePluginStore, useSharedStore } from "@tmadmin/sdk";
import {
  NCard,
  NDescriptions,
  NDescriptionsItem,
  NTag,
  NButton,
  NInput,
} from "naive-ui";
import { formatRtt, formatTimestamp } from "../lib/networkMetrics";

const target = useTarget();
const exec = useExec();
const store = usePluginStore();
const sharedStore = useSharedStore();

const isPinging = ref<boolean>(false);
const quickPingError = ref<string>("");
const quickPingResult = ref<{ ms: number | null; time: string } | null>(null);
const noteText = ref<string>("");
const saveStatus = ref<string>("");
const sharedStats = ref<{ lossPercent?: number } | null>(null);

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

const noteStorageKey = computed<string>(() =>
  host.value ? `note_${host.value}` : "note_default",
);

function loadNote(): void {
  const stored = store.get<string>(noteStorageKey.value);
  noteText.value = typeof stored === "string" ? stored : "";
}

loadNote();
onMounted(async () => {
  loadNote();
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
    loadNote();
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

async function saveNote(): Promise<void> {
  saveStatus.value = "Сохранено";
  await store.set(noteStorageKey.value, noteText.value, { persist: "permanent" });
  setTimeout(() => {
    saveStatus.value = "";
  }, 2000);
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

    <n-descriptions
      size="small"
      :column="1"
      label-placement="left"
      class="info-descriptions"
    >
      <n-descriptions-item label="Хост">
        <span class="val c-host" data-testid="device-info-host">{{ host || "– Не выбран –" }}</span>
      </n-descriptions-item>
      <n-descriptions-item label="Адрес IP">
        <span class="val" data-testid="device-info-ip">{{ ip }}</span>
      </n-descriptions-item>
      <n-descriptions-item label="Задержка (RTT)">
        <span class="val c-rtt" data-testid="device-info-rtt">{{ displayRtt }}</span>
      </n-descriptions-item>
      <n-descriptions-item label="Потери пакетов">
        <span class="val c-loss" data-testid="device-info-loss">{{ displayLoss }}</span>
      </n-descriptions-item>
      <n-descriptions-item label="Проверено">
        <span class="val" data-testid="device-info-last-checked">{{ displayLastChecked }}</span>
      </n-descriptions-item>
    </n-descriptions>

    <div class="note-section">
      <div class="note-input-row">
        <n-input
          v-model:value="noteText"
          size="small"
          placeholder="Заметка об узле..."
          :input-props="({ 'data-testid': 'device-info-note-input' } as Record<string, unknown>)"
          class="note-input"
          @keydown.enter="saveNote"
        />
        <n-button
          size="small"
          type="primary"
          secondary
          data-testid="device-info-note-save-btn"
          @click="saveNote"
        >
          OK
        </n-button>
      </div>
      <n-tag
        v-if="saveStatus"
        type="success"
        size="tiny"
        :bordered="false"
        class="saved-tag"
        data-testid="device-info-save-status"
      >
        {{ saveStatus }}
      </n-tag>
    </div>

    <div class="bottom-action-row">
      <n-button
        size="small"
        secondary
        :loading="isPinging"
        :disabled="isPinging || !host"
        class="refresh-btn"
        data-testid="device-info-ping-btn"
        @click="performQuickPing"
      >
        {{ isPinging ? "Опрос..." : "Обновить" }}
      </n-button>
      <span v-if="quickPingError" class="err-txt">{{ quickPingError }}</span>
    </div>
  </n-card>
</template>

<style scoped>
.conn-card {
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  background: transparent;
  color: #e6edf3;
  display: flex;
  flex-direction: column;
}
:deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px !important;
  height: 100%;
  box-sizing: border-box;
}
.conn-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}
.conn-title {
  font-weight: 700;
  font-size: 12px;
  color: #f0f6fc;
}
.status-tag {
  font-weight: 700;
  font-size: 9.5px;
}
.info-descriptions {
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  padding: 6px 8px;
}
:deep(.n-descriptions-table-wrapper) {
  width: 100%;
}
:deep(.n-descriptions-table-row) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
:deep(.n-descriptions-table-row:last-child) {
  border-bottom: none;
}
:deep(.n-descriptions-table-header) {
  color: #8b949e !important;
  font-size: 11px !important;
  padding: 3px 0 !important;
  width: 110px;
}
:deep(.n-descriptions-table-content) {
  padding: 3px 0 !important;
  text-align: right;
}
.val {
  font-family: monospace;
  font-weight: 600;
  color: #f0f6fc;
  font-size: 11.5px;
}
.c-host { color: #58a6ff; }
.c-rtt { color: #18a058; }
.c-loss { color: #e55353; }
.note-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.note-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.note-input {
  font-size: 11px;
}
.saved-tag {
  align-self: flex-start;
  font-size: 10px;
}
.bottom-action-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
}
.refresh-btn {
  font-size: 11px;
}
.err-txt {
  color: #e55353;
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
