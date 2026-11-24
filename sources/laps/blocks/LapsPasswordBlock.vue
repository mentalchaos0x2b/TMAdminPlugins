<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import {
  defineBlock,
  useTarget,
  onTargetConnect,
  onTargetReset,
  usePluginStore,
  useExec,
  useMessage,
} from "@tmadmin/sdk";
import {
  NButton,
  NTag,
  NSpace,
  NIcon,
  NTooltip,
} from "naive-ui";
import {
  KeyOutline,
  EyeOutline,
  EyeOffOutline,
  CopyOutline,
  CheckmarkOutline,
  RefreshOutline,
  SyncOutline,
  PersonOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import {
  maskPassword,
  calculateLapsExpiration,
  parseLapsOutput,
  type LapsRecord,
} from "../lib/lapsFormatter";

defineBlock({
  title: "Пароль LAPS",
  description: "Пароль локального администратора LAPS из Active Directory",
  icon: "KeyOutline",
  defaultSize: { w: 8, h: 5 },
  minSize: { w: 6, h: 4 },
});

const props = defineProps<{ block?: { id?: string; config?: Record<string, unknown> } }>();

const target = useTarget();
const store = usePluginStore();
const exec = useExec();
const message = useMessage();

const isRevealed = ref(false);
const isQuerying = ref(false);
const isRotating = ref(false);
const copiedToast = ref(false);
const lapsData = ref<LapsRecord | null>(null);
const autoLoadOnConnect = computed<boolean>(() => props.block?.config?.autoLoadOnConnect !== false);
const LAPS_QUERY_TIMEOUT_MS = 6000;
let queryGeneration = 0;

const activeHost = computed(() => target.value?.host || "localhost");
const expirationInfo = computed(() => {
  if (!lapsData.value?.expirationDate || lapsData.value.expirationDate.getTime() === 0) {
    return null;
  }
  return calculateLapsExpiration(lapsData.value.expirationDate);
});

const displayedPassword = computed(() => {
  if (!lapsData.value?.password) return "";
  return isRevealed.value ? lapsData.value.password : maskPassword(lapsData.value.password);
});

const displayExpires = computed(() => lapsData.value?.expiresRaw || expirationInfo.value?.formattedDate || "");

function loadCachedOrInit(): void {
  const host = activeHost.value;
  const shortHost = host.split(".")[0] || host;
  const cached =
    store.get<LapsRecord>(`laps:${host}`) ||
    store.get<LapsRecord>(`laps:${shortHost}`) ||
    store.get<LapsRecord>(`laps_${host}`);
  if (cached && cached.password) {
    lapsData.value = { ...cached, expirationDate: new Date(cached.expirationDate) };
  } else {
    lapsData.value = null;
  }
}

loadCachedOrInit();
onMounted(() => {
  loadCachedOrInit();
  const host = target.value?.host?.trim();
  const status = target.value?.status;
  if (autoLoadOnConnect.value && host && status && status !== "idle" && !lapsData.value) {
    void runLaps(false, host);
  }
});
watch(
  () => target.value?.host,
  (newHost, oldHost) => {
    if (!newHost) {
      lapsData.value = null;
      isRevealed.value = false;
      copiedToast.value = false;
      return;
    }
    if (newHost !== oldHost) {
      isRevealed.value = false;
      copiedToast.value = false;
      loadCachedOrInit();
    }
  },
);

onTargetConnect((event) => {
  isRevealed.value = false;
  copiedToast.value = false;
  const connectHost = event.host?.trim();
  if (autoLoadOnConnect.value && connectHost) {
    void runLaps(false, connectHost);
  }
});

onTargetReset(() => {
  queryGeneration++;
  isQuerying.value = false;
  isRotating.value = false;
  lapsData.value = null;
  isRevealed.value = false;
  copiedToast.value = false;
});

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, messageText: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(messageText)), timeoutMs);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function runLaps(reset: boolean, hostOverride?: string): Promise<void> {
  const targetHost = (hostOverride ?? activeHost.value).trim();
  if (!targetHost) return;
  const host = targetHost.split(".")[0] || targetHost;
  const gen = ++queryGeneration;
  if (reset) isRotating.value = true;
  else isQuerying.value = true;

  try {
    const args = reset ? [host, "-r"] : [host];
    const res = await withTimeout(
      exec.pluginExec("laps.exe", args),
      LAPS_QUERY_TIMEOUT_MS,
      `Таймаут поиска пароля LAPS (${LAPS_QUERY_TIMEOUT_MS / 1000} с)`,
    );
    if (gen !== queryGeneration) return;
    if (res && res.stdout && res.stdout.trim()) {
      const parsed = parseLapsOutput(res.stdout);
      lapsData.value = parsed;
      await store.set(`laps:${host}`, parsed, { persist: "temp" });
      await store.set(`laps:${targetHost}`, parsed, { persist: "temp" });
      message.success(
        reset
          ? "Пароль LAPS сброшен (помечен к ротации)"
          : "Пароль LAPS обновлён из AD",
      );
      return;
    }
    throw new Error(res?.stderr || "Пустой ответ от laps.exe");
  } catch (err) {
    if (gen !== queryGeneration) return;
    if (!reset) {
      lapsData.value = null;
    }
    const msg = err instanceof Error ? err.message : String(err);
    message.error(msg);
  } finally {
    if (gen === queryGeneration) {
      isQuerying.value = false;
      isRotating.value = false;
    }
  }
}

async function copyPassword(): Promise<void> {
  if (!lapsData.value?.password) return;
  try {
    await navigator?.clipboard?.writeText?.(lapsData.value.password);
  } catch {
    // ignore
  }
  copiedToast.value = true;
  message.success("Пароль скопирован в буфер обмена");
  setTimeout(() => {
    copiedToast.value = false;
  }, 1800);
}
</script>

<template>
  <div class="laps-root" data-testid="laps-password-block">
    <!-- Шапка: целевой хост и имя администратора -->
    <div class="laps-top">
      <n-tag size="small" type="warning" round :bordered="false" class="host-tag">
        <template #icon>
          <n-icon :component="KeyOutline" />
        </template>
        <b data-testid="laps-target-host">{{ activeHost }}</b>
      </n-tag>

      <n-tag size="small" :bordered="false" class="acc-tag">
        <template #icon>
          <n-icon :component="PersonOutline" />
        </template>
        <span data-testid="laps-account-name">{{ lapsData?.accountName || "Administrator" }}</span>
      </n-tag>
    </div>

    <!-- Поле пароля с кнопками действий -->
    <div class="pwd-field-card">
      <div class="pwd-content">
        <span class="pwd-label">Пароль:</span>
        <span
          class="pwd-val"
          :class="{ revealed: isRevealed }"
          data-testid="laps-password-display"
        >{{ displayedPassword }}</span>
      </div>

      <n-space :size="4" align="center" class="pwd-actions">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="small"
              quaternary
              :disabled="!lapsData?.password"
              data-testid="laps-toggle-reveal-btn"
              @click="isRevealed = !isRevealed"
            >
              <template #icon>
                <n-icon :component="isRevealed ? EyeOffOutline : EyeOutline" />
              </template>
            </n-button>
          </template>
          <span>{{ isRevealed ? "Скрыть пароль" : "Показать пароль" }}</span>
        </n-tooltip>

        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="small"
              quaternary
              :disabled="!lapsData?.password"
              data-testid="laps-copy-btn"
              @click="copyPassword"
            >
              <template #icon>
                <n-icon :component="copiedToast ? CheckmarkOutline : CopyOutline" />
              </template>
            </n-button>
          </template>
          <span>Скопировать пароль в буфер обмена</span>
        </n-tooltip>
      </n-space>
    </div>

    <!-- Срок действия -->
    <div
      v-if="expirationInfo"
      class="exp-container"
      :class="expirationInfo.status"
      data-testid="laps-expiration-status"
    >
      <div class="exp-left">
        <n-icon :component="TimeOutline" />
        <span>Действует до: <b>{{ displayExpires }}</b></span>
      </div>
      <n-tag
        size="tiny"
        :type="expirationInfo.status === 'expired' ? 'error' : 'success'"
        round
        :bordered="false"
      >
        {{ expirationInfo.humanRemaining }}
      </n-tag>
    </div>

    <!-- Кнопки сброса и обновления -->
    <div class="btn-grid">
      <n-button
        type="warning"
        secondary
        size="small"
        :loading="isRotating"
        :disabled="isRotating || isQuerying"
        data-testid="laps-rotate-btn"
        @click="runLaps(true)"
      >
        <template #icon>
          <n-icon :component="SyncOutline" />
        </template>
        Сбросить
      </n-button>

      <n-button
        type="primary"
        secondary
        size="small"
        :loading="isQuerying"
        :disabled="isQuerying || isRotating"
        data-testid="laps-query-btn"
        @click="runLaps(false)"
      >
        <template #icon>
          <n-icon :component="RefreshOutline" />
        </template>
        Обновить
      </n-button>
    </div>
  </div>
</template>

<style scoped>
.laps-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  height: 100%;
  box-sizing: border-box;
  font-size: 12px;
  color: #e6edf3;
  overflow: hidden;
}

.laps-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.host-tag b {
  font-family: "JetBrains Mono", Consolas, monospace;
}

.acc-tag {
  font-family: "JetBrains Mono", Consolas, monospace;
}

.pwd-field-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 6px 8px;
  min-height: 38px;
  box-sizing: border-box;
}

.pwd-content {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.pwd-label {
  font-size: 11px;
  color: #8b949e;
  flex-shrink: 0;
}

.pwd-val {
  flex: 1;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 13px;
  font-weight: 700;
  color: #f0f6fc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
  min-height: 16px;
}

.pwd-val.revealed {
  color: #63e2b7;
}

.pwd-actions {
  flex-shrink: 0;
}

.exp-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: #8b949e;
}

.exp-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.exp-container b {
  color: #f0f6fc;
  font-family: monospace;
}

.btn-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: auto;
}
</style>
