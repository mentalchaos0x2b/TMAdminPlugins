<script setup lang="ts">
import { ref, computed, watch, onMounted, type Component } from "vue";
import {
  defineBlock,
  useTarget,
  useSecrets,
  useExec,
  usePluginStore,
  useSharedStore,
  useMessage,
  sendTerminalCommand,
} from "@tmadmin/sdk";
import { isValidVncHost, sanitizeVncPassword } from "../lib/vncArgs";
import {
  DEFAULT_VNC_ACTIONS,
  buildSpoolerExecInvocation,
  splitCommandArgs,
  cleanQuotes,
  type BlockActionItem,
} from "../lib/actions";
import {
  NButton,
  NInputNumber,
  NTag,
  NIcon,
  NTooltip,
} from "naive-ui";
import {
  DesktopOutline,
  TvOutline,
  TerminalOutline,
  SettingsOutline,
  FolderOutline,
  PieChartOutline,
  PrintOutline,
  PowerOutline,
  PlayOutline,
  HardwareChipOutline,
} from "@vicons/ionicons5";

defineBlock({
  title: "Быстрые действия",
  description: "Быстрые действия администрирования: TightVNC, UltraVNC, PSExec, RDP, WizTree, диски, печать и пользовательские утилиты",
  icon: "DesktopOutline",
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 8, h: 4 },
});

const props = defineProps<{
  block?: { id?: string; config?: Record<string, unknown> };
}>();

const target = useTarget();
const secrets = useSecrets();
const exec = useExec();
const store = usePluginStore();
const sharedStore = useSharedStore();
const message = useMessage();

const port = ref<number>(5900);
const isBusy = ref<boolean>(false);

const activeHost = computed<string>(() => target.value?.host || "");
const isHostValid = computed<boolean>(() =>
  Boolean(activeHost.value && isValidVncHost(activeHost.value)),
);

function actionRequiresHost(act: BlockActionItem): boolean {
  if (act.isBuiltin) return true;
  const hasMacro = (s?: string) => Boolean(s && /\{host\}|\{target\}/i.test(s));
  return hasMacro(act.command) || hasMacro(act.args) || hasMacro(act.cwd);
}

const actions = computed<BlockActionItem[]>(() => {
  const configured = props.block?.config?.actions;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured as BlockActionItem[];
  }
  const blockId = props.block?.id ?? "";
  const customKey = "quick_actions_custom_" + blockId;
  const legacyCustomKey = "vnc_custom_actions_" + blockId;
  const fromStore =
    store.get<BlockActionItem[]>(customKey) ??
    store.get<BlockActionItem[]>(legacyCustomKey) ??
    (!props.block?.id
      ? store.get<BlockActionItem[]>("quick_actions_custom") ??
        store.get<BlockActionItem[]>("vnc_custom_actions")
      : undefined);
  if (Array.isArray(fromStore) && fromStore.length > 0) {
    return fromStore;
  }
  return DEFAULT_VNC_ACTIONS as BlockActionItem[];
});

function loadSavedStatus(): void {
  const blockKey = props.block?.id ?? "default";
  const savedPort =
    store.get<number>("quick_actions_port_" + blockKey) ??
    store.get<number>("vnc_port_" + blockKey) ??
    store.get<number>("quick_actions_port") ??
    store.get<number>("vnc_port");
  if (typeof savedPort === "number" && savedPort >= 1 && savedPort <= 65535) {
    port.value = savedPort;
  }
}

loadSavedStatus();
onMounted(() => loadSavedStatus());
watch(
  [() => target.value?.host, () => props.block?.id],
  () => loadSavedStatus(),
);

function handlePortUpdate(val: number | null): void {
  if (typeof val === "number" && val >= 1 && val <= 65535) {
    port.value = val;
    const blockKey = props.block?.id ?? "default";
    void store.set("quick_actions_port_" + blockKey, val);
    void store.set("vnc_port_" + blockKey, val);
    if (val === 5900 || blockKey === "default") {
      void store.set("quick_actions_port", val);
      void store.set("vnc_port", val);
    }
  }
}

async function runSpawn(bin: string, args: string[], label: string): Promise<void> {
  if (!isHostValid.value) {
    message.error("Укажите целевой ПК в шапке и нажмите 'Подключиться'");
    return;
  }
  isBusy.value = true;
  try {
    const res = await exec.pluginSpawn(bin, args);
    message.success(`${label} запущен успешно (${bin}, PID: ${res?.pid ?? "ok"})`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    message.error(`${label}: ошибка (${bin}): ${errMsg}`);
  } finally {
    isBusy.value = false;
  }
}

async function runExecCmd(bin: string, args: string[], label: string): Promise<void> {
  if (!isHostValid.value) {
    message.error("Укажите целевой ПК в шапке и нажмите 'Подключиться'");
    return;
  }
  isBusy.value = true;
  try {
    const res = await exec.pluginExec(bin, args);
    if (res.success || res.exit_code === 0) {
      message.success(`${label} выполнено (${bin})`);
    } else {
      message.error(`${label}: ошибка (код ${res.exit_code})`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    message.error(`${label}: ошибка (${bin}): ${errMsg}`);
  } finally {
    isBusy.value = false;
  }
}

async function connectTightVnc(): Promise<void> {
  if (!isHostValid.value) {
    message.error("Укажите целевой ПК в шапке и нажмите 'Подключиться'");
    return;
  }
  const host = activeHost.value.trim();
  let pwd: string | null = null;
  try {
    pwd = await secrets.get("vnc.default_password");
  } catch {
    /* ignore */
  }
  const cleanPwd = pwd ? sanitizeVncPassword(pwd) : "";
  const currentPort = port.value || 5900;
  const args =
    currentPort === 5900
      ? cleanPwd
        ? [host, `-password=${cleanPwd}`]
        : [host]
      : cleanPwd
        ? [`-host=${host}`, `-port=${currentPort}`, `-password=${cleanPwd}`]
        : [`-host=${host}`, `-port=${currentPort}`];
  await runSpawn("TightVNC.exe", args, "TightVNC Viewer");
}

async function connectUltraVnc(): Promise<void> {
  if (!isHostValid.value) {
    message.error("Укажите целевой ПК в шапке и нажмите 'Подключиться'");
    return;
  }
  const host = activeHost.value.trim();
  let pwd: string | null = null;
  try {
    pwd = await secrets.get("vnc.default_password");
  } catch {
    /* ignore */
  }
  const cleanPwd = pwd ? sanitizeVncPassword(pwd) : "";
  const currentPort = port.value || 5900;
  const targetWithPort = `${host}:${currentPort}`;
  const args = cleanPwd ? [targetWithPort, "-password", cleanPwd] : [targetWithPort];
  await runSpawn("UltraVNC.exe", args, "UltraVNC");
}

async function openPsExec(): Promise<void> {
  if (!isHostValid.value) {
    message.error("Укажите целевой ПК в шапке и нажмите 'Подключиться'");
    return;
  }
  const host = activeHost.value.trim();
  const isTerminalActive = sharedStore.get<boolean>("terminal:active") === true;

  sendTerminalCommand({
    command: `PSX.exe \\\\${host} cmd`,
    target: host,
    title: "PSExec",
  });

  if (isTerminalActive) {
    message.success("Команда отправлена во встроенный терминал (PSX.exe)");
  } else {
    await runSpawn("PSX.exe", [`\\\\${host}`, "cmd"], "PSExec CMD");
  }
}

const startRdp = () => runSpawn("mstsc.exe", [`/v:${activeHost.value.trim()}`], "RDP mstsc.exe");
const openCompMgmt = () =>
  runSpawn("compmgmt.msc", [`/computer:\\\\${activeHost.value.trim()}`], "compmgmt.msc");
const openDisk = (d: "c$" | "d$") =>
  runSpawn("explorer.exe", [`\\\\${activeHost.value.trim()}\\${d}`], `Диск ${d.toUpperCase()}`);
const openWizTree = (d: "c$" | "d$") =>
  runSpawn("WizTree/WizTree64.exe", [`\\\\${activeHost.value.trim()}\\${d}`], `WizTree ${d.toUpperCase()}`);
const clearSpooler = (act?: BlockActionItem) => {
  const { command, args } = buildSpoolerExecInvocation(activeHost.value, act);
  return runExecCmd(command, args, "Очистка очереди печати");
};
const rebootHost = () =>
  runExecCmd("shutdown.exe", ["/r", "/m", `\\\\${activeHost.value.trim()}`, "/t", "0"], "Перезагрузка shutdown.exe");

async function runCustomAction(act: BlockActionItem): Promise<void> {
  const needsHost = actionRequiresHost(act);
  if (needsHost && !isHostValid.value) {
    message.error("Укажите целевой ПК в шапке и нажмите 'Подключиться'");
    return;
  }

  const host = isHostValid.value ? activeHost.value.trim() : "";
  const replaceHost = (str?: string): string => {
    if (!str) return "";
    return str
      .replace(/\{host\}/gi, host)
      .replace(/\{target\}/gi, host);
  };

  const rawCmd = replaceHost(act.command);
  const rawArgs = replaceHost(act.args);
  const rawCwd = replaceHost(act.cwd);

  const execPath = cleanQuotes(rawCmd);
  const cleanCwd = cleanQuotes(rawCwd);
  const argsList = splitCommandArgs(rawArgs);

  const isAbsolute = /^[a-zA-Z]:[\\/]|^[\\/]/.test(execPath);

  isBusy.value = true;
  try {
    if (isAbsolute || cleanCwd) {
      const res = await exec.hostSpawn(execPath, argsList, cleanCwd || undefined);
      message.success(`${act.name} запущен (${execPath}, PID: ${res?.pid ?? "ok"})`);
    } else {
      try {
        const res = await exec.pluginSpawn(execPath, argsList);
        message.success(`${act.name} запущен (${execPath}, PID: ${res?.pid ?? "ok"})`);
      } catch {
        const resExec = await exec.pluginExec(execPath, argsList);
        if (resExec.success || resExec.exit_code === 0) {
          message.success(`${act.name} выполнено (${execPath})`);
        } else {
          message.error(`${act.name} завершился с кодом ${resExec.exit_code ?? -1}`);
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    message.error(`${act.name}: ${errMsg}`);
  } finally {
    isBusy.value = false;
  }
}

function handleActionClick(act: BlockActionItem): void {
  switch (act.id) {
    case "tightvnc":
      void connectTightVnc();
      break;
    case "ultravnc":
      void connectUltraVnc();
      break;
    case "rdp":
      void startRdp();
      break;
    case "psexec":
      void openPsExec();
      break;
    case "compmgmt":
      void openCompMgmt();
      break;
    case "disk-c":
      void openDisk("c$");
      break;
    case "disk-d":
      void openDisk("d$");
      break;
    case "wiztree-c":
      void openWizTree("c$");
      break;
    case "wiztree-d":
      void openWizTree("d$");
      break;
    case "spooler":
      void clearSpooler(act);
      break;
    case "reboot":
      void rebootHost();
      break;
    default:
      void runCustomAction(act);
      break;
  }
}

function getButtonType(variant?: string): "default" | "primary" | "warning" | "error" | "info" {
  switch (variant) {
    case "vnc":
      return "primary";
    case "warn":
      return "warning";
    case "danger":
      return "error";
    default:
      return "default";
  }
}

function getActionIcon(id: string): Component {
  switch (id) {
    case "tightvnc":
    case "ultravnc":
      return DesktopOutline;
    case "rdp":
      return TvOutline;
    case "psexec":
      return TerminalOutline;
    case "compmgmt":
      return SettingsOutline;
    case "disk-c":
    case "disk-d":
      return FolderOutline;
    case "wiztree-c":
    case "wiztree-d":
      return PieChartOutline;
    case "spooler":
      return PrintOutline;
    case "reboot":
      return PowerOutline;
    default:
      return PlayOutline;
  }
}
</script>

<template>
  <div class="vnc-root" data-testid="quick-actions-block">
    <div class="top-row">
      <div class="host-section">
        <span class="host-lbl">Узел:</span>
        <n-tag
          :type="isHostValid ? 'success' : 'default'"
          size="small"
          :bordered="false"
          class="host-tag"
        >
          <template #icon>
            <n-icon :component="isHostValid ? HardwareChipOutline : DesktopOutline" />
          </template>
          <b data-testid="vnc-target-host">{{ activeHost || "Не выбран" }}</b>
        </n-tag>
      </div>

      <div class="port-section">
        <span class="port-lbl">Порт:</span>
        <n-input-number
          :value="port"
          :min="1"
          :max="65535"
          size="tiny"
          class="port-input"
          :show-button="false"
          :input-props="({ 'data-testid': 'vnc-port-input' } as Record<string, unknown>)"
          data-testid="vnc-port-input"
          @update:value="handlePortUpdate"
        />
      </div>
    </div>

    <!-- Adaptive Flex Grid: buttons stretch and fill rows smoothly -->
    <div class="actions-flex-container">
      <div
        v-for="act in actions"
        :key="act.id"
        class="action-item-wrapper"
      >
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="small"
              :type="getButtonType(act.variant)"
              :secondary="act.variant !== 'default'"
              :dashed="act.variant === 'default'"
              class="action-btn"
              :class="act.variant"
              :data-testid="act.testId || `vnc-action-${act.id}`"
              :disabled="(actionRequiresHost(act) && !isHostValid) || ((act.id === 'tightvnc' || act.id === 'ultravnc') && isBusy)"
              @click="handleActionClick(act)"
            >
              <template #icon>
                <n-icon :component="getActionIcon(act.id)" />
              </template>
              <span class="btn-label">{{ act.name }}</span>
            </n-button>
          </template>
          <div>
            <div>{{ act.args ? `${act.command} ${act.args}` : act.command }}</div>
            <div v-if="act.cwd" class="tooltip-cwd">
              Папка: {{ act.cwd }}
            </div>
          </div>
        </n-tooltip>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vnc-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  min-height: 100%;
  width: 100%;
  box-sizing: border-box;
  font-size: 11px;
  color: #e6edf3;
}
.top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #8b949e;
  flex-shrink: 0;
}
.host-section {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.host-lbl,
.port-lbl {
  color: #8b949e;
  font-size: 11px;
}
.host-tag b {
  font-family: monospace;
  font-size: 11px;
}
.port-section {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.port-input {
  width: 58px;
  font-family: monospace;
}
.actions-flex-container {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  width: 100%;
}
.action-item-wrapper {
  flex: 1 1 110px;
  min-width: 95px;
  display: flex;
}
.action-item-wrapper :deep(.n-tooltip-trigger) {
  width: 100%;
  display: flex;
}
.action-btn {
  width: 100%;
  font-size: 11px;
  font-weight: 500;
  justify-content: flex-start;
  height: auto;
  min-height: 30px;
  padding: 4px 10px;
}
.btn-label {
  line-height: 1.45;
  padding: 1px 0;
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tooltip-cwd {
  opacity: 0.8;
  font-size: 10.5px;
  margin-top: 2px;
}
</style>
