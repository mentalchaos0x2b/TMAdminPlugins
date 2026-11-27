<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  defineBlock,
  onTargetConnect,
  onTargetReset,
  useExec,
  useFs,
  useMessage,
  useTarget,
} from "@tmadmin/sdk";
import {
  NButton,
  NCard,
  NEmpty,
  NIcon,
  NPopconfirm,
  NSpace,
  NSpin,
  NTag,
  NTooltip,
} from "naive-ui";
import {
  CheckmarkCircleOutline,
  CheckmarkOutline,
  CloudOfflineOutline,
  CopyOutline,
  DownloadOutline,
  FolderOpenOutline,
  NotificationsOutline,
  RefreshOutline,
  TimeOutline,
} from "@vicons/ionicons5";
import {
  buildRemoteCounterPath,
  buildRemoteNsDirPath,
  buildRemoteServiceDateFallbackPath,
  buildRemoteServiceDatePath,
  extractErrorMessage,
  formatDaysAgoLabel,
  isNotFoundError,
  parseServiceDate,
  type ParsedServiceDate,
} from "../lib/notifyService";

defineBlock({
  title: "NotifyService",
  description: "Статус профилактики NotifyService, сброс даты и установка через PSX",
  icon: "NotificationsOutline",
  defaultSize: { w: 8, h: 5 },
  minSize: { w: 6, h: 4 },
});

type ServiceStatus = "idle" | "checking" | "installed" | "not_installed" | "error";
type BusyAction = "reset" | "install" | null;

const INSTALL_BAT_PATH = "\\\\fs2\\install\\Free\\Other\\NotifyService\\install.bat";

const target = useTarget();
const fsApi = useFs();
const execApi = useExec();
const message = useMessage();

const status = ref<ServiceStatus>("idle");
const busyAction = ref<BusyAction>(null);
const serviceDate = ref<ParsedServiceDate | null>(null);
const dateSourceName = ref<"service_date.txt" | "service_date" | null>(null);
const counterValue = ref<string | null>(null);
const copied = ref<boolean>(false);

let checkGeneration = 0;
let checkingHost = "";

const targetHost = computed<string>(() => target.value?.host?.trim() ?? "");
const isOnline = computed<boolean>(() => Boolean(targetHost.value) && target.value?.status === "online");
const isChecking = computed<boolean>(() => status.value === "checking");
const isBusy = computed<boolean>(() => busyAction.value !== null);

const remoteDirPath = computed<string>(() =>
  targetHost.value ? buildRemoteNsDirPath(targetHost.value) : "C:\\$NS",
);

const daysAgoLabel = computed<string>(() =>
  formatDaysAgoLabel(serviceDate.value?.daysAgo ?? null),
);

const daysAgoTagType = computed<"success" | "warning" | "error" | "default">(() => {
  const days = serviceDate.value?.daysAgo;
  if (days === null || days === undefined) return "default";
  if (days >= 30) return "error";
  if (days >= 14) return "warning";
  return "success";
});

const statusMeta = computed<{
  label: string;
  type: "default" | "info" | "success" | "warning" | "error";
}>(() => {
  if (!isOnline.value && status.value !== "checking") {
    return { label: "Не в сети", type: "default" };
  }
  switch (status.value) {
    case "checking":
      return { label: "Проверка...", type: "info" };
    case "installed":
      return { label: "Установлен", type: "success" };
    case "not_installed":
      return { label: "Не установлен", type: "warning" };
    case "error":
      return { label: "Ошибка", type: "error" };
    default:
      return { label: "Ожидание", type: "default" };
  }
});

function resetState(): void {
  checkGeneration++;
  checkingHost = "";
  status.value = "idle";
  busyAction.value = null;
  serviceDate.value = null;
  dateSourceName.value = null;
  counterValue.value = null;
  copied.value = false;
}

async function readServiceDateAndCounter(
  host: string,
  gen: number,
): Promise<{ ok: boolean }> {
  let rawDate: string | null = null;
  let sourceName: "service_date.txt" | "service_date" | null = null;

  try {
    const primaryRes = await fsApi.fs.read(buildRemoteServiceDatePath(host));
    if (gen !== checkGeneration) return { ok: false };
    rawDate = primaryRes.content;
    sourceName = "service_date.txt";
  } catch (err: unknown) {
    if (gen !== checkGeneration) return { ok: false };
    if (!isNotFoundError(err)) {
      message.error(`Не удалось прочитать service_date.txt: ${extractErrorMessage(err)}`);
      return { ok: false };
    }

    try {
      const fallbackRes = await fsApi.fs.read(buildRemoteServiceDateFallbackPath(host));
      if (gen !== checkGeneration) return { ok: false };
      rawDate = fallbackRes.content;
      sourceName = "service_date";
    } catch (fallbackErr: unknown) {
      if (gen !== checkGeneration) return { ok: false };
      if (!isNotFoundError(fallbackErr)) {
        message.error(`Не удалось прочитать service_date: ${extractErrorMessage(fallbackErr)}`);
        return { ok: false };
      }
    }
  }

  serviceDate.value = rawDate !== null ? parseServiceDate(rawDate) : null;
  dateSourceName.value = sourceName;

  try {
    const counterRes = await fsApi.fs.read(buildRemoteCounterPath(host));
    if (gen !== checkGeneration) return { ok: false };
    const trimmedCounter = counterRes.content.trim();
    counterValue.value = trimmedCounter.length > 0 ? trimmedCounter : null;
  } catch {
    if (gen !== checkGeneration) return { ok: false };
    counterValue.value = null;
  }

  return { ok: true };
}

async function checkNotifyService(hostOverride?: string): Promise<void> {
  const host = (hostOverride ?? targetHost.value).trim();
  if (!host || target.value?.status !== "online") {
    return;
  }

  const gen = ++checkGeneration;
  checkingHost = host;
  status.value = "checking";

  try {
    await fsApi.dir.read(buildRemoteNsDirPath(host));
    if (gen !== checkGeneration) return;

    const readResult = await readServiceDateAndCounter(host, gen);
    if (gen !== checkGeneration) return;

    status.value = readResult.ok ? "installed" : "error";
  } catch (err: unknown) {
    if (gen !== checkGeneration) return;
    if (isNotFoundError(err)) {
      status.value = "not_installed";
      serviceDate.value = null;
      dateSourceName.value = null;
      counterValue.value = null;
    } else {
      status.value = "error";
      message.error(`Ошибка проверки ${buildRemoteNsDirPath(host)}: ${extractErrorMessage(err)}`);
    }
  } finally {
    if (gen === checkGeneration) {
      checkingHost = "";
    }
  }
}

async function runPsxCommand(
  args: string[],
  action: Exclude<BusyAction, null>,
  successText: string,
  errorPrefix: string,
): Promise<boolean> {
  if (!isOnline.value || isBusy.value || isChecking.value) {
    return false;
  }

  const gen = checkGeneration;
  busyAction.value = action;

  try {
    const res = await execApi.pluginExec("external/PSX.exe", args);
    if (gen !== checkGeneration) return false;

    const exitOk = res.exit_code === 0 || res.exit_code === null;
    if (res.success && exitOk) {
      message.success(successText);
      return true;
    }

    const details =
      res.stderr.trim() ||
      res.stdout.trim() ||
      `код завершения ${res.exit_code ?? "неизвестен"}`;
    const fullError = `${errorPrefix}: ${details}`;
    message.error(fullError);
    return false;
  } catch (err: unknown) {
    if (gen !== checkGeneration) return false;
    const fullError = `${errorPrefix}: ${extractErrorMessage(err)}`;
    message.error(fullError);
    return false;
  } finally {
    if (gen === checkGeneration) {
      busyAction.value = null;
    }
  }
}

async function handleReset(): Promise<void> {
  const host = targetHost.value;
  if (!host) return;
  const ok = await runPsxCommand(
    [`\\\\${host}`, "NotifyService", "--reset"],
    "reset",
    "Профилактика NotifyService сброшена",
    "Ошибка сброса NotifyService",
  );
  if (ok && isOnline.value) {
    await checkNotifyService(host);
  }
}

async function handleInstall(): Promise<void> {
  const host = targetHost.value;
  if (!host) return;
  const ok = await runPsxCommand(
    [`\\\\${host}`, "cmd", "/c", INSTALL_BAT_PATH],
    "install",
    "Установка NotifyService выполнена",
    "Ошибка установки NotifyService",
  );
  if (ok && isOnline.value) {
    await checkNotifyService(host);
  }
}

async function copyServiceDate(): Promise<void> {
  const textToCopy = serviceDate.value?.formatted || serviceDate.value?.raw;
  if (!textToCopy) return;
  try {
    await navigator?.clipboard?.writeText?.(textToCopy);
    copied.value = true;
    message.success("Дата профилактики скопирована");
    setTimeout(() => {
      copied.value = false;
    }, 1800);
  } catch {
    message.error("Не удалось скопировать дату");
  }
}

onMounted(() => {
  if (isOnline.value) {
    void checkNotifyService(targetHost.value);
  }
});

watch(
  () => [target.value?.host?.trim() ?? "", target.value?.status] as const,
  ([newHost, newStatus], [oldHost, oldStatus]) => {
    if (newHost !== oldHost) {
      resetState();
    }
    if (newHost && newStatus === "online" && (oldStatus !== "online" || newHost !== oldHost || status.value === "idle")) {
      void checkNotifyService(newHost);
    }
  },
);

onTargetConnect((event) => {
  const connectHost = event.host?.trim() || targetHost.value;
  if (!connectHost || target.value?.status !== "online") {
    return;
  }
  if (isChecking.value && checkingHost === connectHost) {
    return;
  }
  void checkNotifyService(connectHost);
});

onTargetReset(() => {
  resetState();
});
</script>

<template>
  <n-card
    size="small"
    :bordered="false"
    :content-style="{ padding: '0' }"
    class="ns-card"
    data-testid="notify-service-block"
  >
    <div class="ns-header">
      <div class="ns-header-left">
        <n-icon :component="NotificationsOutline" class="ns-title-icon" />
        <n-tag
          size="small"
          :type="isOnline ? 'success' : 'default'"
          :bordered="false"
          data-testid="ns-host-tag"
        >
          <span class="ns-mono">{{ targetHost || "Не выбран" }}</span>
        </n-tag>
        <n-tag
          size="small"
          :type="statusMeta.type"
          :bordered="false"
          round
          data-testid="ns-status-tag"
        >
          {{ statusMeta.label }}
        </n-tag>
      </div>

      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button
            size="tiny"
            secondary
            :loading="isChecking"
            :disabled="!isOnline || isChecking || isBusy"
            data-testid="ns-check-btn"
            @click="checkNotifyService()"
          >
            <template #icon>
              <n-icon :component="RefreshOutline" />
            </template>
            Проверить
          </n-button>
        </template>
        <span>Проверить наличие {{ remoteDirPath }}</span>
      </n-tooltip>
    </div>

    <n-spin :show="isChecking" size="small" class="ns-spin">
      <div class="ns-body">
        <!-- Узел не в сети -->
        <n-empty
          v-if="!isOnline && status !== 'installed' && status !== 'not_installed'"
          size="small"
          description="Узел не в сети — проверка C:\$NS недоступна"
          class="ns-empty"
          data-testid="ns-offline-state"
        >
          <template #icon>
            <n-icon :component="CloudOfflineOutline" />
          </template>
        </n-empty>

        <!-- Установлен -->
        <div
          v-if="status === 'installed'"
          class="ns-details"
          data-testid="ns-installed-state"
        >
          <div class="ns-info-panel">
            <div class="ns-info-row">
              <span class="ns-label">
                <n-icon :component="TimeOutline" class="ns-row-icon" />
                Дата профилактики
              </span>
              <div class="ns-value-group">
                <span class="ns-value ns-mono" data-testid="ns-service-date">
                  {{ serviceDate?.formatted || "Не указана" }}
                </span>
                <n-tag
                  v-if="daysAgoLabel"
                  size="tiny"
                  :type="daysAgoTagType"
                  :bordered="false"
                  round
                  data-testid="ns-days-ago-tag"
                >
                  {{ daysAgoLabel }}
                </n-tag>
                <n-tooltip v-if="serviceDate?.formatted" trigger="hover">
                  <template #trigger>
                    <n-button
                      size="tiny"
                      quaternary
                      circle
                      data-testid="ns-copy-date-btn"
                      @click="copyServiceDate"
                    >
                      <template #icon>
                        <n-icon :component="copied ? CheckmarkOutline : CopyOutline" />
                      </template>
                    </n-button>
                  </template>
                  <span>Копировать дату ({{ dateSourceName || "service_date" }})</span>
                </n-tooltip>
              </div>
            </div>

            <div class="ns-info-row">
              <span class="ns-label">
                <n-icon :component="CheckmarkCircleOutline" class="ns-row-icon" />
                Счётчик (counter.txt)
              </span>
              <n-tag
                size="tiny"
                :bordered="false"
                type="info"
                class="ns-mono"
                data-testid="ns-counter"
              >
                {{ counterValue ?? "—" }}
              </n-tag>
            </div>

            <div class="ns-info-row">
              <span class="ns-label">
                <n-icon :component="FolderOpenOutline" class="ns-row-icon" />
                Путь
              </span>
              <span class="ns-path ns-mono">{{ remoteDirPath }}</span>
            </div>
          </div>

          <n-space justify="end" align="center" class="ns-actions">
            <n-popconfirm
              positive-text="Сбросить"
              negative-text="Отмена"
              @positive-click="handleReset"
            >
              <template #trigger>
                <n-button
                  size="tiny"
                  type="warning"
                  secondary
                  :loading="busyAction === 'reset'"
                  :disabled="!isOnline || isBusy || isChecking"
                  data-testid="ns-reset-btn"
                >
                  <template #icon>
                    <n-icon :component="RefreshOutline" />
                  </template>
                  Сбросить профилактику
                </n-button>
              </template>
              Выполнить сброс профилактики NotifyService на {{ targetHost }}?
            </n-popconfirm>
          </n-space>
        </div>

        <!-- Не установлен -->
        <div
          v-else-if="status === 'not_installed'"
          class="ns-not-installed"
          data-testid="ns-not-installed-state"
        >
          <n-empty
            size="small"
            :description="`Папка ${remoteDirPath} не найдена`"
            class="ns-empty"
          >
            <template #icon>
              <n-icon :component="FolderOpenOutline" />
            </template>
            <template #extra>
              <n-button
                size="tiny"
                type="primary"
                :loading="busyAction === 'install'"
                :disabled="!isOnline || isBusy || isChecking"
                data-testid="ns-install-btn"
                @click="handleInstall"
              >
                <template #icon>
                  <n-icon :component="DownloadOutline" />
                </template>
                Установить NotifyService
              </n-button>
            </template>
          </n-empty>
        </div>

        <!-- Ошибка при сети -->
        <div v-else-if="status === 'error' && isOnline" class="ns-error-placeholder">
          <n-empty size="small" description="Не удалось получить статус NotifyService" class="ns-empty" />
        </div>
      </div>
    </n-spin>
  </n-card>
</template>

<style scoped>
.ns-card {
  height: 100%;
  padding: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
  color: var(--tm-tx);
}

.ns-card :deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
}

.ns-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--tm-line);
  flex-shrink: 0;
}

.ns-header-left {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex-wrap: nowrap;
  overflow: hidden;
}

.ns-title-icon {
  color: var(--tm-mut);
  font-size: 14px;
  flex-shrink: 0;
}

.ns-spin {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ns-spin :deep(.n-spin-content) {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.ns-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
}

.ns-details {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
  flex: 1;
  min-height: 0;
}

.ns-info-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--tm-line);
  border-radius: 6px;
}

.ns-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 20px;
}

.ns-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--tm-mut);
  white-space: nowrap;
}

.ns-row-icon {
  font-size: 13px;
  color: var(--tm-mut);
}

.ns-value-group {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.ns-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--tm-tx);
  white-space: nowrap;
}

.ns-path {
  font-size: 11px;
  color: var(--tm-mut);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 65%;
}

.ns-mono {
  font-family: Consolas, "Fira Code", monospace;
}

.ns-actions {
  margin-top: auto;
  flex-shrink: 0;
}

.ns-not-installed,
.ns-error-placeholder {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ns-empty {
  padding: 2px 0;
}

.ns-empty :deep(.n-empty__icon) {
  font-size: 26px;
  width: 26px;
  height: 26px;
}

.ns-empty :deep(.n-empty__description) {
  margin-top: 4px;
  font-size: 12px;
}

.ns-empty :deep(.n-empty__extra) {
  margin-top: 6px;
}
</style>
