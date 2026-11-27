export type TerminalShell = "powershell" | "cmd";

export type TerminalSessionStatus = "connecting" | "online" | "terminated" | "error";

export interface AnsiSpan {
  text: string;
  color?: string;
  bold?: boolean;
}

export interface TerminalLine {
  id: number;
  stream: "stdout" | "stderr" | "system";
  raw: string;
  spans: AnsiSpan[];
  incomplete?: boolean;
  sourceText?: string;
}

export interface TerminalTab {
  id: string;
  number: number;
  title: string;
  shell: TerminalShell;
  target: string;
  sessionId: string | null;
  status: TerminalSessionStatus;
  lines: TerminalLine[];
  history: string[];
  historyIndex: number;
  draftInput: string;
  unlistenFn: (() => void) | null;
}

export interface QuickScript {
  id: string;
  label: string;
  command: string;
  description: string;
}

export const QUICK_SCRIPTS: readonly QuickScript[] = [
  {
    id: "ipconfig",
    label: "ipconfig",
    command: "ipconfig /all",
    description: "Конфигурация сетевых интерфейсов и DNS",
  },
  {
    id: "gpupdate",
    label: "gpupdate",
    command: "gpupdate /force",
    description: "Принудительное обновление групповых политик AD",
  },
  {
    id: "systeminfo",
    label: "systeminfo",
    command: "systeminfo",
    description: "Сводка об ОС, аптайме и памяти",
  },
  {
    id: "netstat",
    label: "netstat",
    command: "netstat -ano",
    description: "Активные TCP/UDP соединения и порты",
  },
  {
    id: "whoami",
    label: "whoami",
    command: "whoami",
    description: "Текущая учётная запись администратора",
  },
];

const ANSI_COLOR_MAP: Record<number, string> = {
  30: "#6e7681",
  31: "#f85149",
  32: "#3fb950",
  33: "#d29922",
  34: "#58a6ff",
  35: "#bc8cff",
  36: "#39c5cf",
  37: "#e6edf3",
  90: "#8b949e",
  91: "#ff7b72",
  92: "#56d364",
  93: "#e3b341",
  94: "#79c0ff",
  95: "#d2a8ff",
  96: "#56d4dd",
  97: "#ffffff",
};

/**
 * Удаляет OSC-последовательности и не-SGR управляющие CSI-коды, сохраняя SGR (\x1b[...m).
 */
function stripNonSgrControlSequences(input: string): string {
  // eslint-disable-next-line no-control-regex
  const withoutOsc = input.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  // eslint-disable-next-line no-control-regex
  return withoutOsc.replace(/\x1b\[[0-9;?]*[A-LN-Za-ln-z]/g, "");
}

/**
 * Разбирает строку с ANSI SGR кодами (\x1b[...m) на массив стилизованных сегментов.
 */
export function parseAnsiToSpans(input: string): AnsiSpan[] {
  if (!input) {
    return [];
  }

  const sanitized = stripNonSgrControlSequences(input);
  if (!sanitized) {
    return [];
  }

  const spans: AnsiSpan[] = [];
  // eslint-disable-next-line no-control-regex
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | undefined;
  let currentBold = false;

  let match: RegExpExecArray | null = regex.exec(sanitized);
  while (match !== null) {
    if (match.index > lastIndex) {
      const textSegment = sanitized.slice(lastIndex, match.index);
      if (textSegment.length > 0) {
        spans.push({
          text: textSegment,
          ...(currentColor ? { color: currentColor } : {}),
          ...(currentBold ? { bold: true } : {}),
        });
      }
    }

    const rawCodes = match[1];
    const codes = rawCodes ? rawCodes.split(";").map((c) => Number.parseInt(c, 10)) : [0];

    for (const code of codes) {
      if (code === 0 || Number.isNaN(code)) {
        currentColor = undefined;
        currentBold = false;
      } else if (code === 1) {
        currentBold = true;
      } else if (code === 22) {
        currentBold = false;
      } else if (code === 39) {
        currentColor = undefined;
      } else if (ANSI_COLOR_MAP[code]) {
        currentColor = ANSI_COLOR_MAP[code];
      }
    }

    lastIndex = regex.lastIndex;
    match = regex.exec(sanitized);
  }

  if (lastIndex < sanitized.length) {
    const remaining = sanitized.slice(lastIndex);
    if (remaining.length > 0) {
      spans.push({
        text: remaining,
        ...(currentColor ? { color: currentColor } : {}),
        ...(currentBold ? { bold: true } : {}),
      });
    }
  }

  return spans;
}

/**
 * Удаляет все ANSI-последовательности из строки.
 */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  const withoutOsc = input.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
  // eslint-disable-next-line no-control-regex
  return withoutOsc.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

let lineIdCounter = 1;

/**
 * Приводит символы возврата каретки (`\r`) внутри одной строки к финальному содержимому:
 * возвращает последний сегмент с видимым текстом (не считая одних лишь ANSI-последовательностей)
 * и не оставляет одиночных `\r`.
 */
function resolveCarriageReturnLine(lineSource: string): string {
  if (!lineSource.includes("\r")) {
    return lineSource;
  }
  const parts = lineSource.split("\r");
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] ?? "";
    if (stripAnsi(part).length > 0) {
      return part;
    }
  }
  return "";
}

/**
 * Сохраняет хвост незавершённой строки, начиная с последнего сегмента с видимым текстом
 * до/после `\r`, чтобы корректно обрабатывать `\r\n` и ANSI-последовательности на границе чанков.
 */
function sliceIncompleteSourceTail(lineSource: string): string {
  if (!lineSource.includes("\r")) {
    return lineSource;
  }
  const parts = lineSource.split("\r");
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] ?? "";
    if (stripAnsi(part).length > 0) {
      return parts.slice(i).join("\r");
    }
  }
  return lineSource.endsWith("\r") ? "\r" : "";
}

/**
 * Добавляет новый пакет вывода PTY в массив строк терминала с поддержкой
 * дописывания незавершённой строки, корректной обработки `\r`/`\r\n` и ограничением размера буфера.
 */
export function appendPayloadToLines(
  existing: TerminalLine[],
  payload: { seq: number; data: string; stream: "stdout" | "stderr" | "system" },
  maxLines = 500,
): TerminalLine[] {
  if (!payload.data) {
    return existing;
  }

  const next = [...existing];
  const lastLine = next[next.length - 1];
  const mergeWithLast = Boolean(lastLine && lastLine.incomplete && lastLine.stream === payload.stream);

  const combined = mergeWithLast ? `${lastLine?.sourceText ?? ""}${payload.data}` : payload.data;
  const normalized = combined.replace(/\r+\n/g, "\n");
  const endsWithNewline = normalized.endsWith("\n");
  const rawParts = normalized.split("\n");
  if (endsWithNewline) {
    rawParts.pop();
  }

  if (rawParts.length === 0) {
    return existing;
  }

  const buildLine = (part: string, isIncomplete: boolean, existingId?: number): TerminalLine => {
    const resolvedPart = resolveCarriageReturnLine(part);
    return {
      id: existingId ?? lineIdCounter++,
      stream: payload.stream,
      raw: stripAnsi(resolvedPart),
      spans: parseAnsiToSpans(resolvedPart),
      incomplete: isIncomplete,
      sourceText: isIncomplete ? sliceIncompleteSourceTail(part) : undefined,
    };
  };

  let startIndex = 0;
  if (mergeWithLast && lastLine) {
    const firstPart = rawParts[0] ?? "";
    const stillIncomplete = rawParts.length === 1 && !endsWithNewline;
    next[next.length - 1] = buildLine(firstPart, stillIncomplete, lastLine.id);
    startIndex = 1;
  }

  for (let i = startIndex; i < rawParts.length; i++) {
    const part = rawParts[i] ?? "";
    const isLastPart = i === rawParts.length - 1;
    const isIncomplete = isLastPart && !endsWithNewline;
    next.push(buildLine(part, isIncomplete));
  }

  if (next.length > maxLines) {
    return next.slice(next.length - maxLines);
  }

  return next;
}

/**
 * Добавляет команду в историю без дублирования подряд идущих одинаковых команд.
 */
export function pushCommandHistory(
  history: string[],
  command: string,
  maxHistory = 50,
): string[] {
  const trimmed = command.trim();
  if (!trimmed) return history;

  const filtered = history[history.length - 1] === trimmed ? [...history] : [...history, trimmed];
  if (filtered.length > maxHistory) {
    return filtered.slice(filtered.length - maxHistory);
  }
  return filtered;
}

/**
 * Навигация по истории команд стрелками Up / Down.
 */
export function navigateHistory(
  history: string[],
  currentIndex: number,
  direction: "up" | "down",
): { index: number; value: string } {
  if (history.length === 0) {
    return { index: -1, value: "" };
  }

  if (direction === "up") {
    const nextIdx = currentIndex <= 0 ? (currentIndex === -1 ? history.length - 1 : 0) : currentIndex - 1;
    return {
      index: nextIdx,
      value: history[nextIdx] ?? "",
    };
  }

  if (currentIndex === -1 || currentIndex >= history.length - 1) {
    return { index: -1, value: "" };
  }

  const nextIdx = currentIndex + 1;
  return {
    index: nextIdx,
    value: history[nextIdx] ?? "",
  };
}

/**
 * Форматирует компактный заголовок вкладки в стиле Windows 11 Terminal.
 */
export function formatTabTitle(
  shell: TerminalShell,
  targetHost: string,
  tabNumber: number,
): string {
  const shellLabel = shell === "powershell" ? "PowerShell" : "CMD";
  const cleanHost = targetHost.trim() || "localhost";
  return tabNumber > 1 ? `${shellLabel} #${tabNumber} · ${cleanHost}` : `${shellLabel} · ${cleanHost}`;
}

/**
 * Создаёт новое состояние вкладки терминала.
 */
export function createTerminalTab(options: {
  id: string;
  number: number;
  shell: TerminalShell;
  target: string;
}): TerminalTab {
  const cleanTarget = options.target.trim() || "localhost";
  return {
    id: options.id,
    number: options.number,
    title: formatTabTitle(options.shell, cleanTarget, options.number),
    shell: options.shell,
    target: cleanTarget,
    sessionId: null,
    status: "connecting",
    lines: [],
    history: [],
    historyIndex: -1,
    draftInput: "",
    unlistenFn: null,
  };
}
