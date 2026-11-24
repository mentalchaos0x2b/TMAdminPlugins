export interface ParsedServiceDate {
  raw: string;
  formatted: string;
  daysAgo: number | null;
}

const MS_PER_DAY = 86_400_000;

/**
 * Формирует UNC-путь к папке C:\$NS на удалённом ПК.
 */
export function buildRemoteNsDirPath(host: string): string {
  return `\\\\${host.trim()}\\c$\\$NS`;
}

/**
 * Формирует UNC-путь к файлу service_date.txt на удалённом ПК.
 */
export function buildRemoteServiceDatePath(host: string): string {
  return `\\\\${host.trim()}\\c$\\$NS\\service_date.txt`;
}

/**
 * Формирует резервный UNC-путь к файлу service_date (без расширения) на удалённом ПК.
 */
export function buildRemoteServiceDateFallbackPath(host: string): string {
  return `\\\\${host.trim()}\\c$\\$NS\\service_date`;
}

/**
 * Формирует UNC-путь к файлу counter.txt на удалённом ПК.
 */
export function buildRemoteCounterPath(host: string): string {
  return `\\\\${host.trim()}\\c$\\$NS\\counter.txt`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDate(date: Date, includeTime: boolean): string {
  const datePart = `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`;
  if (!includeTime) {
    return datePart;
  }
  const timePart = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  return `${datePart} ${timePart}`;
}

function createValidatedLocalDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date | null {
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Парсит дату профилактики из формата `20.10.2026 8:46:00` или ISO/пробельного формата
 * и вычисляет давность в днях.
 */
export function parseServiceDate(raw: string, now: Date = new Date()): ParsedServiceDate {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { raw: "", formatted: "", daysAgo: null };
  }

  let parsedDate: Date | null = null;
  let hasTime = false;

  // Формат DD.MM.YYYY [H:mm[:ss]] или DD/MM/YYYY [H:mm[:ss]]
  const ruMatch = trimmed.match(
    /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (ruMatch) {
    const day = Number(ruMatch[1]);
    const month = Number(ruMatch[2]);
    const year = Number(ruMatch[3]);
    hasTime = ruMatch[4] !== undefined;
    const hour = hasTime ? Number(ruMatch[4]) : 0;
    const minute = hasTime ? Number(ruMatch[5]) : 0;
    const second = ruMatch[6] !== undefined ? Number(ruMatch[6]) : 0;
    parsedDate = createValidatedLocalDate(year, month, day, hour, minute, second);
  }

  // ISO или пробельный формат YYYY-MM-DD[T ]HH:mm[:ss][.sss][Z|+hh:mm]
  if (!parsedDate) {
    const isoMatch = trimmed.match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    );
    if (isoMatch) {
      hasTime = isoMatch[4] !== undefined;
      if (isoMatch[7]) {
        const tzDate = new Date(trimmed);
        if (!Number.isNaN(tzDate.getTime())) {
          parsedDate = tzDate;
        }
      } else {
        const year = Number(isoMatch[1]);
        const month = Number(isoMatch[2]);
        const day = Number(isoMatch[3]);
        const hour = hasTime ? Number(isoMatch[4]) : 0;
        const minute = hasTime ? Number(isoMatch[5]) : 0;
        const second = isoMatch[6] !== undefined ? Number(isoMatch[6]) : 0;
        parsedDate = createValidatedLocalDate(year, month, day, hour, minute, second);
      }
    }
  }

  // Резервный разбор стандартным Date.parse для нестандартных строковых дат
  if (!parsedDate && !/^\d+$/.test(trimmed)) {
    const timestamp = Date.parse(trimmed);
    if (!Number.isNaN(timestamp)) {
      parsedDate = new Date(timestamp);
      hasTime = /:\d{2}/.test(trimmed);
    }
  }

  if (!parsedDate) {
    return {
      raw: trimmed,
      formatted: trimmed,
      daysAgo: null,
    };
  }

  const daysAgo = Math.floor((now.getTime() - parsedDate.getTime()) / MS_PER_DAY);
  return {
    raw: trimmed,
    formatted: formatDate(parsedDate, hasTime),
    daysAgo,
  };
}

/**
 * Определяет, является ли ошибка отсутствием файла или папки (в отличие от сетевых ошибок и ошибок доступа).
 */
export function isNotFoundError(err: unknown): boolean {
  let msg: string;
  if (err instanceof Error) {
    msg = err.message;
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code) {
      msg = `${code} ${msg}`;
    }
  } else if (typeof err === "object" && err !== null) {
    const obj = err as { code?: unknown; message?: unknown };
    const parts = [obj.code, obj.message]
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    msg = parts.length > 0 ? parts.join(" ") : String(err);
  } else {
    msg = String(err ?? "");
  }

  const lower = msg.toLowerCase();
  if (!lower.trim()) {
    return false;
  }

  // Сначала отсеиваем сетевые и права-доступа ошибки (включая Windows error 53/67, где встречается "not found")
  const networkOrAccessPatterns = [
    "network path was not found",
    "network name cannot be found",
    "сетевой путь не найден",
    "не найден сетевой путь",
    "не найдено сетевое имя",
    "access is denied",
    "permission denied",
    "отказано в доступе",
    "eacces",
    "eperm",
    "etimedout",
    "econnrefused",
    "ehostunreach",
    "enetunreach",
    "timed out",
    "timeout",
    "os error 5",
    "os error 53",
    "os error 67",
    "os error 1326",
  ];
  if (networkOrAccessPatterns.some((pattern) => lower.includes(pattern))) {
    return false;
  }

  const notFoundPatterns = [
    "enoent",
    "path not found",
    "not found:",
    "no such file or directory",
    "cannot find the file specified",
    "cannot find the path specified",
    "не удается найти указанный файл",
    "не удаётся найти указанный файл",
    "не удается найти указанный путь",
    "не удаётся найти указанный путь",
    "does not exist",
    "не существует",
  ];
  if (notFoundPatterns.some((pattern) => lower.includes(pattern))) {
    return true;
  }

  if (/\bos error [23]\b/.test(lower)) {
    return true;
  }

  return lower.trim() === "not found";
}

/**
 * Извлекает читаемый текст ошибки.
 */
export function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message || "Неизвестная ошибка";
  }
  if (typeof err === "string") {
    return err || "Неизвестная ошибка";
  }
  return String(err ?? "Неизвестная ошибка");
}

/**
 * Форматирует подпись давности профилактики для отображения в UI.
 */
export function formatDaysAgoLabel(daysAgo: number | null): string {
  if (daysAgo === null) return "";
  if (daysAgo < 0) return `через ${Math.abs(daysAgo)} дн.`;
  if (daysAgo === 0) return "сегодня";
  if (daysAgo === 1) return "1 дн. назад";
  return `${daysAgo} дн. назад`;
}
