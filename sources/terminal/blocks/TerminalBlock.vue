<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import {
  defineBlock,
  useTarget,
  useTerminal,
  usePluginStore,
  useSharedStore,
  type TerminalRunCommandPayload,
} from "@tmadmin/sdk";
import {
  NButton,
  NButtonGroup,
  NTag,
  NInput,
} from "naive-ui";
import {
  QUICK_SCRIPTS,
  appendPayloadToLines,
  pushCommandHistory,
  navigateHistory,
  getActivePtySession,
  setActivePtySession,
  removeActivePtySession,
  type TerminalLine,
  type ActivePtySession,
} from "../lib/terminalBuffer";

defineBlock({
  title: "Встроенный терминал",
  icon: "TerminalOutline",
  description: "Интерактивная PTY-сессия PowerShell / CMD с контекстом целевого узла",
  defaultSize: { w: 24, h: 8 },
  minSize: { w: 8, h: 4 },
});

const target = useTarget();
const terminal = useTerminal();
const pluginStore = usePluginStore();
const sharedStore = useSharedStore();

const sessionId = ref<string | null>(null);
const sessionStatus = ref<"connecting" | "online" | "terminated" | "error">("connecting");
const selectedShell = ref<"powershell" | "cmd">("powershell");
const lines = ref<TerminalLine[]>([]);
const commandInput = ref<string>("");
const history = ref<string[]>([]);
const historyIndex = ref<number>(-1);
const viewportRef = ref<HTMLElement | null>(null);

let unlistenFn: (() => void) | null = null;
let unsubscribeCmd: (() => void) | null = null;

const activeHost = computed<string>(() => target.value?.host || "localhost");
const targetKey = computed<string>(() => activeHost.value);
const statusLabel = computed<string>(() => {
  if (sessionStatus.value === "online") return "ACTIVE PTY";
  if (sessionStatus.value === "connecting") return "SPAWNING...";
  if (sessionStatus.value === "terminated") return "STOPPED";
  return "ERROR";
});

function loadPersistedState(): void {
  const host = targetKey.value;
  const savedLines =
    pluginStore.get<TerminalLine[]>(`term:lines:${host}`) ||
    pluginStore.get<TerminalLine[]>("term:lines");
  if (Array.isArray(savedLines) && savedLines.length > 0) {
    lines.value = savedLines;
  }
  const savedHist =
    pluginStore.get<string[]>("term:history") || pluginStore.get<string[]>("last_history");
  if (Array.isArray(savedHist)) {
    history.value = savedHist;
  }
}

function persistLines(): void {
  void pluginStore.set(`term:lines:${targetKey.value}`, lines.value, { persist: "temp" });
  void pluginStore.set("term:lines", lines.value, { persist: "temp" });
}

function persistHistory(): void {
  void pluginStore.set("term:history", history.value, { persist: "temp" });
  void pluginStore.set("last_history", history.value, { persist: "temp" });
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  if (viewportRef.value) {
    viewportRef.value.scrollTop = viewportRef.value.scrollHeight;
  }
}

async function attachOrStartSession(forceRestart = false): Promise<void> {
  if (unlistenFn) {
    unlistenFn();
    unlistenFn = null;
  }

  const key = targetKey.value;
  const existing = getActivePtySession(key);

  if (existing && !forceRestart && existing.status === "online") {
    sessionId.value = existing.id;
    selectedShell.value = existing.shell;
    lines.value = existing.lines;
    history.value = existing.history;
    sessionStatus.value = "online";

    try {
      unlistenFn = await terminal.listen(existing.id, (payload) => {
        lines.value = appendPayloadToLines(lines.value, payload);
        existing.lines = lines.value;
        persistLines();
        void scrollToBottom();
      });
      existing.unlisten = unlistenFn;
      await scrollToBottom();
      return;
    } catch {
      removeActivePtySession(key);
    }
  }

  if (sessionId.value && forceRestart) {
    try {
      await terminal.kill(sessionId.value);
    } catch {
      /* ignore */
    }
    sessionId.value = null;
  }

  sessionStatus.value = "connecting";
  try {
    const res = await terminal.spawn({ shell: selectedShell.value, target: activeHost.value });
    sessionId.value = res.id;
    sessionStatus.value = "online";

    const sessionObj: ActivePtySession = {
      id: res.id,
      target: key,
      shell: selectedShell.value,
      lines: lines.value,
      history: history.value,
      status: "online",
    };
    setActivePtySession(key, sessionObj);

    unlistenFn = await terminal.listen(res.id, (payload) => {
      lines.value = appendPayloadToLines(lines.value, payload);
      sessionObj.lines = lines.value;
      persistLines();
      void scrollToBottom();
    });
    sessionObj.unlisten = unlistenFn;
    await scrollToBottom();
  } catch (err) {
    sessionStatus.value = "error";
    const msg = err instanceof Error ? err.message : String(err);
    lines.value = appendPayloadToLines(lines.value, {
      seq: 0,
      data: `[TMAdmin PTY Error] ${msg}\n`,
      stream: "stderr",
    });
    persistLines();
  }
}

async function handleIncomingCommand(payload: TerminalRunCommandPayload): Promise<void> {
  if (!payload || !payload.command) return;

  const cmd = payload.command.trim();
  const label = payload.title || payload.description;

  if (label) {
    lines.value = appendPayloadToLines(lines.value, {
      seq: Date.now(),
      data: `[TMAdmin Run: ${label}] ${cmd}\n`,
      stream: "system",
    });
  }

  if (!sessionId.value || sessionStatus.value !== "online") {
    await attachOrStartSession();
  }

  history.value = pushCommandHistory(history.value, cmd);
  historyIndex.value = -1;
  persistHistory();

  if (sessionId.value && sessionStatus.value === "online") {
    if (payload.asScript) {
      await terminal.execScript(sessionId.value, cmd);
    } else {
      await terminal.write(sessionId.value, `${cmd}\r\n`);
    }
  } else {
    lines.value = appendPayloadToLines(lines.value, {
      seq: Date.now(),
      data: `> ${cmd}\n`,
      stream: "stdout",
    });
  }
  persistLines();
  await scrollToBottom();
}

async function sendCommand(): Promise<void> {
  const cmd = commandInput.value.trim();
  if (!cmd || !sessionId.value) return;
  if (cmd.toLowerCase() === "cls" || cmd.toLowerCase() === "clear") {
    clearTerminal();
    commandInput.value = "";
    return;
  }
  history.value = pushCommandHistory(history.value, cmd);
  historyIndex.value = -1;
  commandInput.value = "";
  persistHistory();
  await terminal.write(sessionId.value, `${cmd}\r\n`);
  await scrollToBottom();
}

async function cancelCurrentCommand(): Promise<void> {
  if (!sessionId.value) return;
  try {
    await terminal.write(sessionId.value, "\x03");
  } catch {
    /* ignore */
  }
  lines.value = appendPayloadToLines(lines.value, {
    seq: Date.now(),
    data: "^C\n",
    stream: "system",
  });
  persistLines();
  await scrollToBottom();
}

async function runQuickScript(command: string): Promise<void> {
  if (!sessionId.value) await attachOrStartSession();
  if (!sessionId.value) return;
  history.value = pushCommandHistory(history.value, command);
  historyIndex.value = -1;
  persistHistory();
  await terminal.execScript(sessionId.value, command);
  await scrollToBottom();
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === "c" && e.ctrlKey) {
    const inputEl = e.target as HTMLInputElement | null;
    const hasSelection = inputEl && inputEl.selectionStart !== inputEl.selectionEnd;
    if (!hasSelection) {
      e.preventDefault();
      commandInput.value = "";
      void cancelCurrentCommand();
      return;
    }
  }
  if (e.key === "Enter") {
    e.preventDefault();
    void sendCommand();
    return;
  }
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    const nav = navigateHistory(
      history.value,
      historyIndex.value,
      e.key === "ArrowUp" ? "up" : "down",
    );
    historyIndex.value = nav.index;
    commandInput.value = nav.value;
  }
}

function clearTerminal(): void {
  lines.value = [];
  const existing = getActivePtySession(targetKey.value);
  if (existing) {
    existing.lines = [];
  }
  persistLines();
}

async function switchShell(shell: "powershell" | "cmd"): Promise<void> {
  if (selectedShell.value === shell && sessionStatus.value === "online") return;
  selectedShell.value = shell;
  if (sessionId.value) {
    try {
      await terminal.kill(sessionId.value);
    } catch {
      /* ignore */
    }
  }
  removeActivePtySession(targetKey.value);
  await attachOrStartSession(true);
}

watch(
  () => target.value?.host,
  async (newHost, oldHost) => {
    if (newHost !== oldHost) {
      loadPersistedState();
      await attachOrStartSession(false);
    }
  },
);

loadPersistedState();
onMounted(async () => {
  loadPersistedState();
  void sharedStore.set("terminal:active", true, "temp");

  unsubscribeCmd = terminal.onRunCommand((payload) => {
    void handleIncomingCommand(payload);
  });

  try {
    const pending = sharedStore.get<TerminalRunCommandPayload>("terminal:pending_command");
    if (pending?.command) {
      void sharedStore.remove("terminal:pending_command");
      void handleIncomingCommand(pending);
    }
  } catch {
    /* ignore */
  }

  await attachOrStartSession(false);
});

onUnmounted(() => {
  void sharedStore.set("terminal:active", false, "temp");
  if (unsubscribeCmd) {
    unsubscribeCmd();
    unsubscribeCmd = null;
  }
  if (unlistenFn) {
    unlistenFn();
    unlistenFn = null;
  }
});
</script>

<template>
  <div class="tm-term" data-testid="terminal-block">
    <div class="tm-bar">
      <div class="tm-status">
        <span class="dot" :class="`dot-${sessionStatus}`" />
        <n-tag
          size="tiny"
          :bordered="false"
          :type="sessionStatus === 'online' ? 'success' : sessionStatus === 'connecting' ? 'warning' : 'error'"
          class="badge"
          data-testid="terminal-session-status"
        >
          {{ statusLabel }}
        </n-tag>
        <span v-if="sessionId" class="sid" data-testid="terminal-session-id">{{ sessionId }}</span>
        <n-tag
          size="tiny"
          :bordered="false"
          type="info"
          class="tgt"
          data-testid="terminal-target-badge"
        >
          <b>{{ activeHost }}</b>
        </n-tag>
      </div>

      <div class="tm-scripts" data-testid="terminal-quick-scripts">
        <n-button
          v-for="item in QUICK_SCRIPTS"
          :key="item.id"
          size="tiny"
          secondary
          class="sc-btn"
          :title="item.description"
          :data-testid="`quick-script-${item.id}`"
          @click="runQuickScript(item.command)"
        >
          ⚡ {{ item.label }}
        </n-button>
      </div>

      <div class="tm-acts">
        <n-button
          size="tiny"
          type="error"
          secondary
          class="cancel-btn"
          data-testid="terminal-cancel-btn"
          title="Прервать выполнение команды (Ctrl+C)"
          :disabled="!sessionId"
          @click="cancelCurrentCommand"
        >
          ✕ Отмена (Ctrl+C)
        </n-button>

        <n-button-group size="tiny">
          <n-button
            size="tiny"
            :type="selectedShell === 'powershell' ? 'primary' : 'default'"
            :secondary="selectedShell !== 'powershell'"
            class="sh-btn"
            data-testid="shell-btn-powershell"
            @click="switchShell('powershell')"
          >
            PS
          </n-button>
          <n-button
            size="tiny"
            :type="selectedShell === 'cmd' ? 'primary' : 'default'"
            :secondary="selectedShell !== 'cmd'"
            class="sh-btn"
            data-testid="shell-btn-cmd"
            @click="switchShell('cmd')"
          >
            CMD
          </n-button>
        </n-button-group>

        <n-button
          size="tiny"
          secondary
          class="sc-btn"
          data-testid="terminal-clear-btn"
          @click="clearTerminal"
        >
          Очистить
        </n-button>
      </div>
    </div>

    <div ref="viewportRef" class="tm-vp" data-testid="terminal-viewport">
      <div v-if="lines.length === 0" class="tm-empty">Готов к вводу команд...</div>
      <div
        v-for="line in lines"
        :key="line.id"
        class="tm-line"
        :class="`line-${line.stream}`"
        data-testid="terminal-line"
      >
        <span class="tm-ts">{{ line.timestamp }}</span>
        <span class="tm-body">
          <span
            v-for="(s, i) in line.spans"
            :key="i"
            :style="{ color: s.color, fontWeight: s.bold ? '700' : undefined }"
          >{{ s.text }}</span>
        </span>
      </div>
    </div>

    <div class="tm-in-row">
      <span class="tm-pfx">
        {{ selectedShell === "powershell" ? `PS [${activeHost}]>` : `C:\\ [${activeHost}]>` }}
      </span>
      <n-input
        v-model:value="commandInput"
        size="small"
        placeholder="Команда..."
        class="tm-in"
        :input-props="({ 'data-testid': 'terminal-input' } as Record<string, unknown>)"
        @keydown="handleKeyDown"
      />
      <n-button
        size="small"
        type="primary"
        class="tm-send"
        data-testid="terminal-send-btn"
        @click="sendCommand"
      >
        Выполнить
      </n-button>
    </div>
  </div>
</template>

<style scoped>
.tm-term {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #0b0f15;
  color: #e6edf3;
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  overflow: hidden;
  box-sizing: border-box;
}
.tm-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
  background: #141a23;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  white-space: nowrap;
  overflow: hidden;
  flex-shrink: 0;
}
.tm-status,
.tm-scripts,
.tm-acts {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #d29922;
  flex-shrink: 0;
}
.dot-online {
  background: #3fb950;
}
.dot-terminated,
.dot-error {
  background: #f85149;
}
.badge {
  font-weight: 700;
  font-size: 9.5px;
}
.sid {
  color: #6e7681;
  font-size: 10px;
}
.tgt {
  font-size: 10.5px;
}
.sc-btn {
  font-size: 10px;
}
.cancel-btn {
  font-size: 10px;
}
.sh-btn {
  font-size: 10px;
  font-weight: 700;
}
.tm-vp {
  flex: 1;
  min-height: 50px;
  overflow-y: auto;
  padding: 6px 8px;
  line-height: 1.35;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: #0b0f15;
}
.tm-empty {
  color: #6e7681;
  font-style: italic;
}
.tm-line {
  display: flex;
  gap: 6px;
  white-space: pre-wrap;
  word-break: break-all;
}
.tm-ts {
  color: #484f58;
  font-size: 9.5px;
  flex-shrink: 0;
}
.line-stderr .tm-body {
  color: #f85149;
}
.line-system .tm-body {
  color: #58a6ff;
}
.tm-in-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: #141a23;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}
.tm-pfx {
  color: #3fb950;
  font-weight: 700;
  white-space: nowrap;
  font-size: 11px;
}
.tm-in {
  flex: 1;
  min-width: 0;
}
.tm-send {
  font-weight: 600;
}
</style>
