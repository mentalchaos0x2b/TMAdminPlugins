<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, h } from "vue";
import {
  defineBlock,
  useTarget,
  useTerminal,
  useTerminalSettings,
  useSharedStore,
  type TerminalRunCommandPayload,
} from "@tmadmin/sdk";
import {
  NButton,
  NDropdown,
  NTooltip,
  NIcon,
  NInput,
  type DropdownOption,
} from "naive-ui";
import {
  AddOutline,
  ChevronDownOutline,
  CloseOutline,
  FlashOutline,
  StopOutline,
  TrashOutline,
  RefreshOutline,
  TerminalOutline,
  CodeSlashOutline,
  ReturnDownBackOutline,
} from "@vicons/ionicons5";
import {
  QUICK_SCRIPTS,
  appendPayloadToLines,
  pushCommandHistory,
  navigateHistory,
  createTerminalTab,
  formatTabTitle,
  type TerminalTab,
  type TerminalShell,
  type TerminalSessionStatus,
} from "../lib/terminalBuffer";

defineBlock({
  title: "Встроенный терминал",
  icon: "TerminalOutline",
  description: "Многовкладочная PTY-сессия PowerShell / CMD в стиле Windows 11 Terminal",
  defaultSize: { w: 24, h: 8 },
  minSize: { w: 8, h: 4 },
});

const target = useTarget();
const terminal = useTerminal();
const termSettings = useTerminalSettings();
const sharedStore = useSharedStore();

const tabs = ref<TerminalTab[]>([]);
const activeTabId = ref<string | null>(null);
const fallbackDraft = ref<string>("");
const viewportRef = ref<HTMLElement | null>(null);
const commandInputRef = ref<InstanceType<typeof NInput> | null>(null);

let tabIdCounter = 1;
let tabNumberCounter = 1;
let isUnmounted = false;
let unsubscribeCmd: (() => void) | null = null;

const pendingSpawns = new Map<string, Promise<void>>();
const tabGenerations = new Map<string, number>();
const closedTabs = new Set<string>();

const activeHost = computed<string>(() => target.value?.host?.trim() || "localhost");

const activeTab = computed<TerminalTab | null>(
  () => tabs.value.find((tab) => tab.id === activeTabId.value) ?? null,
);

const commandInput = computed<string>({
  get: () => (activeTab.value ? activeTab.value.draftInput : fallbackDraft.value),
  set: (value: string) => {
    if (activeTab.value) {
      activeTab.value.draftInput = value;
    } else {
      fallbackDraft.value = value;
    }
  },
});

const promptPrefix = computed<string>(() => {
  const shell = activeTab.value?.shell ?? "powershell";
  const host = activeTab.value?.target ?? activeHost.value;
  return shell === "powershell" ? `PS [${host}]>` : `C:\\ [${host}]>`;
});

const terminalTypographyStyle = computed<Record<string, string>>(() => ({
  fontSize: `${termSettings.value.fontSize}px`,
  fontFamily: termSettings.value.fontFamily,
}));

const rootThemeVars = computed<Record<string, string>>(() => ({
  "--tm-accent": termSettings.value.accent,
}));

const inputThemeOverrides = computed(() => ({
  color: "transparent",
  colorFocus: "rgba(255, 255, 255, 0.03)",
  colorDisabled: "transparent",
  textColor: "#f3f3f3",
  placeholderColor: "#6e7681",
  caretColor: termSettings.value.accent,
  border: "1px solid transparent",
  borderHover: "1px solid rgba(255, 255, 255, 0.12)",
  borderFocus: `1px solid ${termSettings.value.accent}`,
  boxShadowFocus: "none",
  fontSizeSmall: `${termSettings.value.fontSize}px`,
  heightSmall: "28px",
  paddingSmall: "0 8px",
}));

const inputElementProps = computed<Record<string, unknown>>(() => ({
  "data-testid": "terminal-input",
  style: {
    fontSize: `${termSettings.value.fontSize}px`,
    fontFamily: termSettings.value.fontFamily,
  },
}));

const profileOptions = computed<DropdownOption[]>(() => [
  {
    key: "powershell",
    label: "PowerShell",
    icon: () => h(NIcon, null, { default: () => h(TerminalOutline) }),
    props: {
      "data-testid": "profile-option-powershell",
    },
  },
  {
    key: "cmd",
    label: "Командная строка (CMD)",
    icon: () => h(NIcon, null, { default: () => h(CodeSlashOutline) }),
    props: {
      "data-testid": "profile-option-cmd",
    },
  },
]);

const quickScriptOptions = computed<DropdownOption[]>(() =>
  QUICK_SCRIPTS.map((item) => ({
    key: item.command,
    label: `${item.command} — ${item.description}`,
    icon: () => h(NIcon, null, { default: () => h(FlashOutline) }),
    props: {
      "data-testid": `quick-script-${item.id}`,
      title: item.description,
    },
  })),
);

function statusLabel(status: TerminalSessionStatus): string {
  switch (status) {
    case "online":
      return "Активна";
    case "connecting":
      return "Подключение...";
    case "terminated":
      return "Завершена";
    default:
      return "Ошибка";
  }
}

function isSessionClosedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not found|closed|terminated/i.test(msg);
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (viewportRef.value) {
    viewportRef.value.scrollTop = viewportRef.value.scrollHeight;
  }
}

function focusInput(): void {
  const selection = typeof window !== "undefined" ? window.getSelection()?.toString() : "";
  if (selection) return;
  commandInputRef.value?.focus?.();
}

async function startTabSession(tab: TerminalTab): Promise<void> {
  const generation = (tabGenerations.get(tab.id) ?? 0) + 1;
  tabGenerations.set(tab.id, generation);

  if (tab.unlistenFn) {
    tab.unlistenFn();
    tab.unlistenFn = null;
  }

  tab.status = "connecting";
  tab.sessionId = null;

  const spawnPromise = (async () => {
    try {
      const res = await terminal.spawn({
        shell: tab.shell,
        target: tab.target,
      });

      if (isUnmounted || closedTabs.has(tab.id) || tabGenerations.get(tab.id) !== generation) {
        void terminal.kill(res.id).catch(() => {});
        return;
      }

      tab.sessionId = res.id;
      tab.status = "online";

      const unlisten = await terminal.listen(res.id, (payload) => {
        if (isUnmounted || closedTabs.has(tab.id) || tabGenerations.get(tab.id) !== generation) {
          return;
        }
        tab.lines = appendPayloadToLines(tab.lines, payload);
        if (payload.stream === "system" && /Session .+ terminated\./i.test(payload.data)) {
          tab.status = "terminated";
        }
        if (activeTabId.value === tab.id) {
          void scrollToBottom();
        }
      });

      if (isUnmounted || closedTabs.has(tab.id) || tabGenerations.get(tab.id) !== generation) {
        unlisten();
        void terminal.kill(res.id).catch(() => {});
        return;
      }

      tab.unlistenFn = unlisten;
      if (activeTabId.value === tab.id) {
        await scrollToBottom();
      }
    } catch (err) {
      if (isUnmounted || closedTabs.has(tab.id) || tabGenerations.get(tab.id) !== generation) {
        return;
      }
      tab.status = "error";
      const msg = err instanceof Error ? err.message : String(err);
      tab.lines = appendPayloadToLines(tab.lines, {
        seq: Date.now(),
        data: `[TMAdmin PTY Error] ${msg}\n`,
        stream: "stderr",
      });
    } finally {
      if (pendingSpawns.get(tab.id) === spawnPromise) {
        pendingSpawns.delete(tab.id);
      }
    }
  })();

  pendingSpawns.set(tab.id, spawnPromise);
  await spawnPromise;
}

async function createTab(
  shell: TerminalShell = "powershell",
  customTarget?: string,
): Promise<TerminalTab> {
  if (tabs.value.length === 0) {
    tabNumberCounter = 1;
  }

  const id = `tab-${tabIdCounter++}`;
  const tabNumber = tabNumberCounter++;
  const targetHost = customTarget?.trim() || activeHost.value;

  const newTab = createTerminalTab({
    id,
    number: tabNumber,
    shell,
    target: targetHost,
  });

  if (fallbackDraft.value && tabs.value.length === 0) {
    newTab.draftInput = fallbackDraft.value;
    fallbackDraft.value = "";
  }

  tabs.value.push(newTab);
  const reactiveTab = tabs.value[tabs.value.length - 1];
  activeTabId.value = reactiveTab.id;

  await startTabSession(reactiveTab);
  return reactiveTab;
}

function selectTab(tabId: string): void {
  if (activeTabId.value === tabId) return;
  activeTabId.value = tabId;
  void scrollToBottom();
}

async function closeTab(tabId: string): Promise<void> {
  const index = tabs.value.findIndex((t) => t.id === tabId);
  if (index === -1) return;

  const [tab] = tabs.value.splice(index, 1);
  closedTabs.add(tabId);
  pendingSpawns.delete(tabId);

  if (tab.unlistenFn) {
    tab.unlistenFn();
    tab.unlistenFn = null;
  }

  if (tab.sessionId) {
    const sid = tab.sessionId;
    tab.sessionId = null;
    try {
      await terminal.kill(sid);
    } catch {
      /* ignore */
    }
  }

  if (activeTabId.value === tabId) {
    const nextTab = tabs.value[index] ?? tabs.value[index - 1] ?? null;
    activeTabId.value = nextTab ? nextTab.id : null;
  }

  await scrollToBottom();
}

async function restartTab(tabId: string): Promise<void> {
  const tab = tabs.value.find((t) => t.id === tabId);
  if (!tab) return;

  if (tab.unlistenFn) {
    tab.unlistenFn();
    tab.unlistenFn = null;
  }

  if (tab.sessionId) {
    const oldSid = tab.sessionId;
    tab.sessionId = null;
    try {
      await terminal.kill(oldSid);
    } catch {
      /* ignore */
    }
  }

  tab.target = activeHost.value;
  tab.title = formatTabTitle(tab.shell, tab.target, tab.number);
  tab.lines = [];
  await startTabSession(tab);
}

async function restartActiveTab(): Promise<void> {
  if (!activeTab.value) return;
  await restartTab(activeTab.value.id);
}

async function ensureActiveReadyTab(preferredTarget?: string): Promise<TerminalTab> {
  let tab = activeTab.value;
  if (!tab) {
    tab = await createTab("powershell", preferredTarget);
  } else {
    const pending = pendingSpawns.get(tab.id);
    if (pending) {
      await pending;
    }
    if (!tab.sessionId || tab.status === "terminated" || tab.status === "error") {
      await restartTab(tab.id);
    }
  }
  return tab;
}

async function writeToTab(tab: TerminalTab, data: string, asScript = false): Promise<void> {
  if (!tab.sessionId) {
    tab.lines = appendPayloadToLines(tab.lines, {
      seq: Date.now(),
      data: "[Сессия завершена. Нажмите ↻ для перезапуска или + для новой вкладки]\n",
      stream: "system",
    });
    return;
  }

  try {
    if (asScript) {
      await terminal.execScript(tab.sessionId, data);
    } else {
      await terminal.write(tab.sessionId, data);
    }
  } catch (err) {
    tab.status = isSessionClosedError(err) ? "terminated" : "error";
    const msg = err instanceof Error ? err.message : String(err);
    tab.lines = appendPayloadToLines(tab.lines, {
      seq: Date.now(),
      data: `[TMAdmin PTY Error] ${msg}\n`,
      stream: "stderr",
    });
  }
}

async function handleIncomingCommand(payload: TerminalRunCommandPayload): Promise<void> {
  if (!payload || !payload.command) return;

  const cmd = payload.command.trim();
  if (!cmd) return;
  const label = payload.title || payload.description;

  const tab = await ensureActiveReadyTab(payload.target);

  if (label) {
    tab.lines = appendPayloadToLines(tab.lines, {
      seq: Date.now(),
      data: `[TMAdmin Run: ${label}] ${cmd}\n`,
      stream: "system",
    });
  }

  tab.history = pushCommandHistory(tab.history, cmd);
  tab.historyIndex = -1;

  if (tab.sessionId && tab.status === "online") {
    if (payload.asScript) {
      await writeToTab(tab, cmd, true);
    } else {
      await writeToTab(tab, `${cmd}\r\n`, false);
    }
  } else {
    tab.lines = appendPayloadToLines(tab.lines, {
      seq: Date.now(),
      data: `> ${cmd}\n`,
      stream: "stdout",
    });
  }

  await scrollToBottom();
}

async function sendCommand(): Promise<void> {
  const cmd = commandInput.value.trim();
  if (!cmd) return;

  if (cmd.toLowerCase() === "cls" || cmd.toLowerCase() === "clear") {
    clearActiveTab();
    commandInput.value = "";
    return;
  }

  let tab = activeTab.value;
  if (!tab) {
    fallbackDraft.value = "";
    tab = await createTab("powershell");
  } else {
    tab.draftInput = "";
    const pending = pendingSpawns.get(tab.id);
    if (pending) {
      await pending;
    }
  }

  tab.history = pushCommandHistory(tab.history, cmd);
  tab.historyIndex = -1;

  await writeToTab(tab, `${cmd}\r\n`, false);
  await scrollToBottom();
}

async function cancelCurrentCommand(): Promise<void> {
  const tab = activeTab.value;
  if (!tab) return;

  const pending = pendingSpawns.get(tab.id);
  if (pending) {
    await pending;
  }
  if (!tab.sessionId) return;

  const prevCount = tab.lines.length;
  const prevLastRaw = tab.lines[tab.lines.length - 1]?.raw ?? "";

  try {
    await terminal.write(tab.sessionId, "\x03");
  } catch (err) {
    if (isSessionClosedError(err)) {
      tab.status = "terminated";
    }
  }

  const addedOrUpdated = tab.lines.slice(Math.max(0, prevCount - 1));
  const hasEcho = addedOrUpdated.some(
    (line, idx) =>
      (tab.lines.length > prevCount || idx > 0 || line.raw !== prevLastRaw) &&
      line.raw.includes("^C"),
  );

  if (!hasEcho) {
    tab.lines = appendPayloadToLines(tab.lines, {
      seq: Date.now(),
      data: "^C\n",
      stream: "system",
    });
  }

  await scrollToBottom();
}

async function runQuickScript(command: string): Promise<void> {
  const tab = await ensureActiveReadyTab();
  if (!tab.sessionId) return;

  tab.history = pushCommandHistory(tab.history, command);
  tab.historyIndex = -1;

  await writeToTab(tab, command, true);
  await scrollToBottom();
}

function clearActiveTab(): void {
  if (!activeTab.value) return;
  activeTab.value.lines = [];
}

function handleProfileSelect(key: string | number): void {
  const shell: TerminalShell = key === "cmd" ? "cmd" : "powershell";
  void createTab(shell);
}

function handleQuickScriptSelect(key: string | number): void {
  const cmd = String(key).trim();
  if (!cmd) return;
  void runQuickScript(cmd);
}

function getWindowSelectionText(): string {
  return typeof window !== "undefined" ? (window.getSelection?.()?.toString() ?? "") : "";
}

function hasInputSelection(inputEl: HTMLInputElement | null): boolean {
  return Boolean(
    inputEl &&
      inputEl.selectionStart !== null &&
      inputEl.selectionEnd !== null &&
      inputEl.selectionStart !== inputEl.selectionEnd,
  );
}

function copySelectionFallback(text: string): void {
  if (!text) return;
  try {
    void Promise.resolve(navigator?.clipboard?.writeText?.(text)).catch(() => {});
  } catch {
    /* ignore */
  }
}

function handleInputKeyDown(e: KeyboardEvent): void {
  const keyLower = e.key.toLowerCase();
  const isCtrlC =
    (keyLower === "c" || e.code === "KeyC") &&
    e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey;

  if (isCtrlC) {
    const inputEl = e.target as HTMLInputElement | null;
    const inputSelected = hasInputSelection(inputEl);
    const windowSel = getWindowSelectionText();
    if (inputSelected || windowSel.length > 0) {
      if (!inputSelected && windowSel.length > 0) {
        copySelectionFallback(windowSel);
      }
      return;
    }
    e.preventDefault();
    commandInput.value = "";
    void cancelCurrentCommand();
    return;
  }

  if (
    (keyLower === "l" || e.code === "KeyL") &&
    e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey
  ) {
    e.preventDefault();
    clearActiveTab();
    return;
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void sendCommand();
    return;
  }

  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    if (!activeTab.value) return;
    const nav = navigateHistory(
      activeTab.value.history,
      activeTab.value.historyIndex,
      e.key === "ArrowUp" ? "up" : "down",
    );
    activeTab.value.historyIndex = nav.index;
    commandInput.value = nav.value;
  }
}

function handleContainerKeyDown(e: KeyboardEvent): void {
  const targetEl = e.target as HTMLElement | null;
  if (targetEl?.closest(".tm-in")) return;

  const keyLower = e.key.toLowerCase();
  const isCtrlC =
    (keyLower === "c" || e.code === "KeyC") &&
    e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey;

  if (isCtrlC) {
    const activeInput =
      typeof document !== "undefined" && document.activeElement instanceof HTMLInputElement
        ? document.activeElement
        : null;
    const inputSelected = hasInputSelection(activeInput);
    const windowSel = getWindowSelectionText();
    if (inputSelected || windowSel.length > 0) {
      if (!inputSelected && windowSel.length > 0) {
        copySelectionFallback(windowSel);
      }
      return;
    }
    e.preventDefault();
    void cancelCurrentCommand();
    return;
  }

  if (
    (keyLower === "l" || e.code === "KeyL") &&
    e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey &&
    !e.metaKey
  ) {
    e.preventDefault();
    clearActiveTab();
  }
}

onMounted(async () => {
  isUnmounted = false;
  void sharedStore.set("terminal:active", true, "temp");

  unsubscribeCmd = terminal.onRunCommand((payload) => {
    void handleIncomingCommand(payload);
  });

  let pendingHandled = false;
  try {
    const pending = sharedStore.get<TerminalRunCommandPayload>("terminal:pending_command");
    if (pending?.command) {
      pendingHandled = true;
      void sharedStore.remove("terminal:pending_command");
      await handleIncomingCommand(pending);
    }
  } catch {
    /* ignore */
  }

  if (!pendingHandled && tabs.value.length === 0 && !isUnmounted) {
    await createTab("powershell");
  }
});

onUnmounted(() => {
  isUnmounted = true;
  void sharedStore.set("terminal:active", false, "temp");

  if (unsubscribeCmd) {
    unsubscribeCmd();
    unsubscribeCmd = null;
  }

  for (const tab of tabs.value) {
    closedTabs.add(tab.id);
    if (tab.unlistenFn) {
      tab.unlistenFn();
      tab.unlistenFn = null;
    }
    if (tab.sessionId) {
      const sid = tab.sessionId;
      tab.sessionId = null;
      void terminal.kill(sid).catch(() => {});
    }
  }

  pendingSpawns.clear();
});
</script>

<template>
  <div
    class="tm-term"
    :style="rootThemeVars"
    data-testid="terminal-block"
    @keydown="handleContainerKeyDown"
  >
    <header class="tm-tabbar" data-testid="terminal-tabbar">
      <div class="tm-tabs-area">
        <div class="tm-tabs-scroll" role="tablist" aria-label="Вкладки терминала">
          <div
            v-for="tab in tabs"
            :key="tab.id"
            role="tab"
            :aria-selected="tab.id === activeTabId"
            class="tm-tab"
            :class="{ 'is-active': tab.id === activeTabId }"
            :style="tab.id === activeTabId ? { borderTopColor: termSettings.accent } : undefined"
            :data-tab-id="tab.id"
            :data-shell="tab.shell"
            :data-status="tab.status"
            data-testid="terminal-tab"
            @click="selectTab(tab.id)"
          >
            <span
              class="tm-shell-badge"
              :class="`badge-${tab.shell}`"
              data-testid="terminal-tab-badge"
            >
              {{ tab.shell === "powershell" ? "PS" : "CMD" }}
            </span>

            <span class="tm-tab-title" :title="tab.title" data-testid="terminal-tab-title">
              {{ tab.title }}
            </span>

            <span
              class="tm-tab-dot"
              :class="`dot-${tab.status}`"
              :title="statusLabel(tab.status)"
              data-testid="terminal-tab-status"
            />

            <n-button
              quaternary
              size="tiny"
              class="tm-tab-close"
              title="Закрыть вкладку"
              data-testid="terminal-tab-close"
              @click.stop="closeTab(tab.id)"
            >
              <template #icon>
                <n-icon :size="12">
                  <CloseOutline />
                </n-icon>
              </template>
            </n-button>
          </div>
        </div>

        <div class="tm-new-tab-group">
          <n-tooltip trigger="hover">
            <template #trigger>
              <n-button
                quaternary
                size="tiny"
                class="tm-icon-btn tm-new-tab-btn"
                data-testid="terminal-new-tab-btn"
                @click="createTab('powershell')"
              >
                <template #icon>
                  <n-icon :size="14">
                    <AddOutline />
                  </n-icon>
                </template>
              </n-button>
            </template>
            Новая вкладка (PowerShell)
          </n-tooltip>

          <n-tooltip trigger="hover">
            <template #trigger>
              <span class="tm-tool-wrap">
                <n-dropdown
                  trigger="click"
                  placement="bottom-start"
                  :options="profileOptions"
                  @select="handleProfileSelect"
                >
                  <n-button
                    quaternary
                    size="tiny"
                    class="tm-icon-btn tm-profile-btn"
                    data-testid="terminal-profile-dropdown-btn"
                  >
                    <template #icon>
                      <n-icon :size="12">
                        <ChevronDownOutline />
                      </n-icon>
                    </template>
                  </n-button>
                </n-dropdown>
              </span>
            </template>
            Выбрать профиль (PowerShell / CMD)
          </n-tooltip>
        </div>
      </div>

      <div class="tm-tabbar-actions" data-testid="terminal-actions">
        <n-tooltip trigger="hover">
          <template #trigger>
            <span class="tm-tool-wrap">
              <n-dropdown
                trigger="click"
                placement="bottom-end"
                :options="quickScriptOptions"
                @select="handleQuickScriptSelect"
              >
                <n-button
                  quaternary
                  size="tiny"
                  class="tm-icon-btn"
                  data-testid="terminal-quick-scripts-btn"
                >
                  <template #icon>
                    <n-icon :size="14">
                      <FlashOutline />
                    </n-icon>
                  </template>
                </n-button>
              </n-dropdown>
            </span>
          </template>
          Быстрые скрипты
        </n-tooltip>

        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              quaternary
              size="tiny"
              class="tm-icon-btn tm-cancel-btn"
              :disabled="!activeTab?.sessionId || activeTab.status === 'terminated' || activeTab.status === 'error'"
              data-testid="terminal-cancel-btn"
              @click="cancelCurrentCommand"
            >
              <template #icon>
                <n-icon :size="14">
                  <StopOutline />
                </n-icon>
              </template>
            </n-button>
          </template>
          Прервать (Ctrl+C)
        </n-tooltip>

        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              quaternary
              size="tiny"
              class="tm-icon-btn"
              :disabled="!activeTab"
              data-testid="terminal-clear-btn"
              @click="clearActiveTab"
            >
              <template #icon>
                <n-icon :size="14">
                  <TrashOutline />
                </n-icon>
              </template>
            </n-button>
          </template>
          Очистить буфер (Ctrl+L)
        </n-tooltip>

        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              quaternary
              size="tiny"
              class="tm-icon-btn"
              :disabled="!activeTab"
              data-testid="terminal-restart-btn"
              @click="restartActiveTab"
            >
              <template #icon>
                <n-icon :size="14">
                  <RefreshOutline />
                </n-icon>
              </template>
            </n-button>
          </template>
          Перезапустить вкладку
        </n-tooltip>
      </div>
    </header>

    <div
      ref="viewportRef"
      class="tm-vp"
      tabindex="-1"
      :style="terminalTypographyStyle"
      data-testid="terminal-viewport"
      @click="focusInput"
    >
      <div v-if="!activeTab" class="tm-empty-state" data-testid="terminal-empty-state">
        <n-icon :size="26" class="tm-empty-icon">
          <TerminalOutline />
        </n-icon>
        <div class="tm-empty-text">Нет открытых вкладок терминала</div>
        <div class="tm-empty-actions">
          <n-button
            size="tiny"
            secondary
            type="primary"
            data-testid="terminal-empty-new-ps-btn"
            @click.stop="createTab('powershell')"
          >
            <template #icon>
              <n-icon :size="13"><AddOutline /></n-icon>
            </template>
            PowerShell
          </n-button>
          <n-button
            size="tiny"
            secondary
            data-testid="terminal-empty-new-cmd-btn"
            @click.stop="createTab('cmd')"
          >
            <template #icon>
              <n-icon :size="13"><AddOutline /></n-icon>
            </template>
            CMD
          </n-button>
        </div>
      </div>

      <template v-else>
        <div v-if="activeTab.lines.length === 0" class="tm-empty-hint">
          {{ activeTab.status === "connecting" ? "Запуск сессии..." : "Готов к вводу команд..." }}
        </div>
        <div
          v-for="line in activeTab.lines"
          :key="line.id"
          class="tm-line"
          :class="`line-${line.stream}`"
          data-testid="terminal-line"
        ><span class="tm-body"><template v-if="line.spans.length > 0"><span
              v-for="(span, idx) in line.spans"
              :key="idx"
              :style="{ color: span.color, fontWeight: span.bold ? '700' : undefined }"
            >{{ span.text }}</span></template></span></div>
      </template>
    </div>

    <div class="tm-in-row" :style="terminalTypographyStyle">
      <span
        class="tm-pfx"
        :style="{ color: termSettings.accent, ...terminalTypographyStyle }"
        data-testid="terminal-prompt-prefix"
      >
        {{ promptPrefix }}
      </span>
      <n-input
        ref="commandInputRef"
        v-model:value="commandInput"
        size="small"
        placeholder="Введите команду..."
        class="tm-in"
        :style="terminalTypographyStyle"
        :theme-overrides="inputThemeOverrides"
        :input-props="inputElementProps"
        @keydown="handleInputKeyDown"
      />
      <n-tooltip trigger="hover">
        <template #trigger>
          <n-button
            quaternary
            size="tiny"
            class="tm-icon-btn tm-send-btn"
            data-testid="terminal-send-btn"
            @click="sendCommand"
          >
            <template #icon>
              <n-icon :size="14">
                <ReturnDownBackOutline />
              </n-icon>
            </template>
          </n-button>
        </template>
        Выполнить (Enter)
      </n-tooltip>
    </div>
  </div>
</template>

<style scoped>
.tm-term {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #0c0c0c;
  color: #cccccc;
  overflow: hidden;
  box-sizing: border-box;
  outline: none;
}

.tm-tabbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px 0 6px;
  min-height: 34px;
  background: #1f1f1f;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
  overflow: hidden;
}

.tm-tabs-area {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.tm-tabs-scroll {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  min-width: 0;
  scrollbar-width: none;
}

.tm-tabs-scroll::-webkit-scrollbar {
  display: none;
}

.tm-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 6px 0 8px;
  border-radius: 6px 6px 0 0;
  border-top: 2px solid transparent;
  background: transparent;
  color: #9d9d9d;
  cursor: pointer;
  user-select: none;
  flex-shrink: 0;
  min-width: 84px;
  max-width: 210px;
  transition: background-color 0.14s ease, color 0.14s ease;
}

.tm-tab:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #e6edf3;
}

.tm-tab.is-active {
  background: #0c0c0c;
  color: #f3f3f3;
  margin-bottom: -1px;
  padding-bottom: 1px;
}

.tm-shell-badge {
  font-family: Consolas, "Fira Code", monospace;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 3px;
  letter-spacing: 0.02em;
  flex-shrink: 0;
}

.badge-powershell {
  background: rgba(56, 139, 253, 0.2);
  color: #79c0ff;
  border: 1px solid rgba(56, 139, 253, 0.35);
}

.badge-cmd {
  background: rgba(139, 148, 158, 0.2);
  color: #c9d1d9;
  border: 1px solid rgba(139, 148, 158, 0.32);
}

.tm-tab-title {
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.tm-tab-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #d29922;
}

.dot-online {
  background: #3fb950;
}

.dot-connecting {
  background: #d29922;
}

.dot-terminated {
  background: #6e7681;
}

.dot-error {
  background: #f85149;
}

.tm-tab-close {
  width: 18px;
  height: 18px;
  padding: 0;
  color: #8b949e;
  border-radius: 4px;
  opacity: 0.75;
  flex-shrink: 0;
}

.tm-tab-close:hover {
  opacity: 1;
  color: #f3f3f3;
  background: rgba(255, 255, 255, 0.1);
}

.tm-new-tab-group {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding-bottom: 3px;
  flex-shrink: 0;
}

.tm-tabbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-bottom: 3px;
  flex-shrink: 0;
}

.tm-tool-wrap {
  display: inline-flex;
  align-items: center;
}

.tm-icon-btn {
  color: #b1bac4;
  min-width: 24px;
  height: 24px;
  padding: 0 5px;
  border-radius: 4px;
}

.tm-icon-btn:hover:not(:disabled) {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
}

.tm-profile-btn {
  min-width: 18px;
  padding: 0 3px;
}

.tm-cancel-btn:hover:not(:disabled) {
  color: #ff7b72;
  background: rgba(248, 81, 73, 0.14);
}

.tm-vp {
  flex: 1;
  min-height: 60px;
  overflow-y: auto;
  padding: 8px 12px;
  line-height: 1.4;
  display: flex;
  flex-direction: column;
  background: #0c0c0c;
  color: #e6edf3;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
  outline: none;
}

.tm-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #8b949e;
  font-family: "Segoe UI", system-ui, sans-serif;
  font-size: 12px;
}

.tm-empty-icon {
  color: #6e7681;
}

.tm-empty-text {
  color: #8b949e;
}

.tm-empty-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tm-empty-hint {
  color: #6e7681;
  font-style: italic;
}

.tm-line {
  display: block;
  flex-shrink: 0;
  margin: 0;
  padding: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.4;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.tm-body {
  display: inline;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.tm-body:empty::before {
  content: "\00a0";
  display: inline-block;
  width: 0;
}

.line-stderr .tm-body {
  color: #f85149;
}

.line-system .tm-body {
  color: #79c0ff;
}

.tm-in-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px 6px 12px;
  background: #0c0c0c;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.tm-pfx {
  font-weight: 700;
  white-space: nowrap;
  flex-shrink: 0;
}

.tm-in {
  flex: 1;
  min-width: 0;
}

.tm-in :deep(.n-input-wrapper) {
  padding-left: 4px;
  padding-right: 4px;
}

.tm-in :deep(.n-input__input-el) {
  color: #f3f3f3;
}

.tm-send-btn {
  flex-shrink: 0;
}
</style>
