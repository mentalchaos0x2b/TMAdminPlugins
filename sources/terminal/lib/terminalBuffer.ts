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
  timestamp: string;
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
 * Разбирает строку с ANSI SGR кодами (\x1b[...m) на массив стилизованных сегментов.
 */
export function parseAnsiToSpans(input: string): AnsiSpan[] {
  if (!input) {
    return [];
  }

  const spans: AnsiSpan[] = [];
  // eslint-disable-next-line no-control-regex
  const regex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | undefined;
  let currentBold = false;

  let match: RegExpExecArray | null = regex.exec(input);
  while (match !== null) {
    if (match.index > lastIndex) {
      const textSegment = input.slice(lastIndex, match.index);
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
    match = regex.exec(input);
  }

  if (lastIndex < input.length) {
    const remaining = input.slice(lastIndex);
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
  return input.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

let lineIdCounter = 1;

/**
 * Добавляет новый пакет вывода PTY в массив строк терминала с ограничением размера буфера.
 */
export function appendPayloadToLines(
  existing: TerminalLine[],
  payload: { seq: number; data: string; stream: "stdout" | "stderr" | "system" },
  maxLines = 400,
): TerminalLine[] {
  const normalized = payload.data.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rawParts = normalized.split("\n");

  const next = [...existing];
  const now = new Date().toLocaleTimeString("ru-RU", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  for (let i = 0; i < rawParts.length; i++) {
    const part = rawParts[i] ?? "";
    // Пропускаем пустой хвост после завершающего \n
    if (i === rawParts.length - 1 && part === "" && rawParts.length > 1) {
      continue;
    }

    next.push({
      id: lineIdCounter++,
      stream: payload.stream,
      raw: stripAnsi(part),
      spans: parseAnsiToSpans(part),
      timestamp: now,
    });
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

  // direction === "down"
  if (currentIndex === -1 || currentIndex >= history.length - 1) {
    return { index: -1, value: "" };
  }

  const nextIdx = currentIndex + 1;
  return {
    index: nextIdx,
    value: history[nextIdx] ?? "",
  };
}

export interface ActivePtySession {
  id: string;
  target: string;
  shell: "powershell" | "cmd";
  lines: TerminalLine[];
  history: string[];
  status: "connecting" | "online" | "terminated" | "error";
  unlisten?: (() => void) | null;
}

const activePtySessions = new Map<string, ActivePtySession>();

export function getActivePtySession(targetKey: string): ActivePtySession | undefined {
  return activePtySessions.get(targetKey);
}

export function setActivePtySession(targetKey: string, session: ActivePtySession): void {
  activePtySessions.set(targetKey, session);
}

export function removeActivePtySession(targetKey: string): void {
  activePtySessions.delete(targetKey);
}

export function clearAllPtySessions(): void {
  activePtySessions.clear();
}

