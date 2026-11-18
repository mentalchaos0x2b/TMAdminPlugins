export interface LapsExpirationInfo {
  expirationDate: Date;
  formattedDate: string;
  isExpired: boolean;
  daysRemaining: number;
  hoursRemaining: number;
  humanRemaining: string;
  status: "valid" | "expiring_soon" | "expired";
}

export interface LapsRecord {
  accountName: string;
  password: string;
  expirationDate: Date;
  expirationFileTime: string;
  expiresRaw?: string;
  target?: string;
  reset?: boolean;
}

export interface LapsExePayload {
  target: string;
  password: string;
  expires: string;
  reset: boolean;
  error?: string;
}

const WINDOWS_EPOCH_DIFF_NS = 116444736000000000n;

export function fileTimeToDate(fileTime: string | number | bigint): Date {
  try {
    const rawBigInt = typeof fileTime === "bigint" ? fileTime : BigInt(String(fileTime).trim());
    if (rawBigInt <= 0n) return new Date(0);
    const millis = Number((rawBigInt - WINDOWS_EPOCH_DIFF_NS) / 10000n);
    return new Date(millis);
  } catch {
    return new Date(0);
  }
}

export function dateToFileTime(date: Date): bigint {
  const millis = BigInt(date.getTime());
  return millis * 10000n + WINDOWS_EPOCH_DIFF_NS;
}

export function maskPassword(password: string, visibleLength = 0): string {
  if (!password) return "";
  if (visibleLength <= 0) return "•".repeat(password.length);
  const prefix = password.slice(0, visibleLength);
  const maskedPart = "•".repeat(Math.max(0, password.length - visibleLength));
  return prefix + maskedPart;
}

export function formatLapsDate(date: Date): string {
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "Не задано";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const mins = String(date.getMinutes()).padStart(2, "0");
  return `${day}.${month}.${year} ${hours}:${mins}`;
}

export function calculateLapsExpiration(
  expirationInput: string | number | bigint | Date,
  now: Date = new Date(),
): LapsExpirationInfo {
  let expirationDate: Date;
  if (expirationInput instanceof Date) {
    expirationDate = expirationInput;
  } else if (typeof expirationInput === "string" && expirationInput.includes("-")) {
    expirationDate = new Date(expirationInput.replace(" ", "T"));
  } else {
    expirationDate = fileTimeToDate(expirationInput);
  }

  const diffMs = expirationDate.getTime() - now.getTime();
  const isExpired = diffMs <= 0 || expirationDate.getTime() === 0 || Number.isNaN(diffMs);
  const totalHours = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60));
  const totalDays = Math.floor(totalHours / 24);

  let status: "valid" | "expiring_soon" | "expired" = "valid";
  let humanRemaining = `${totalDays} дн.`;
  if (isExpired) {
    status = "expired";
    humanRemaining = "Пароль истёк";
  } else if (totalDays === 0) {
    status = "expiring_soon";
    humanRemaining = `Менее ${Math.max(1, totalHours)} ч.`;
  } else if (totalDays === 1) {
    status = "expiring_soon";
    humanRemaining = "1 день";
  }

  return {
    expirationDate,
    formattedDate: formatLapsDate(expirationDate),
    isExpired,
    daysRemaining: isExpired ? 0 : totalDays,
    hoursRemaining: isExpired ? 0 : totalHours,
    humanRemaining,
    status,
  };
}

export function parseLapsOutput(stdout: string): LapsRecord {
  const raw = (stdout || "").trim();
  if (!raw) throw new Error("Пустой ответ от laps.exe");
  let parsed: Partial<LapsExePayload>;
  try {
    parsed = JSON.parse(raw) as Partial<LapsExePayload>;
  } catch {
    throw new Error(`Ошибка разбора ответа LAPS: ${raw.slice(0, 120)}`);
  }
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.password) throw new Error(`Пароль LAPS для "${parsed.target || "узла"}" не найден в AD`);

  const expiresStr = String(parsed.expires || "").trim();
  const parsedDate = expiresStr ? new Date(expiresStr.replace(" ", "T")) : new Date(0);
  const validDate = Number.isNaN(parsedDate.getTime()) ? new Date(0) : parsedDate;

  return {
    accountName: "Administrator",
    password: String(parsed.password),
    expirationDate: validDate,
    expirationFileTime: validDate.getTime() > 0 ? dateToFileTime(validDate).toString() : "0",
    expiresRaw: expiresStr || formatLapsDate(validDate),
    target: parsed.target,
    reset: Boolean(parsed.reset),
  };
}
