/**
 * Утилиты для работы с сетевыми принтерами и SMB-шарами на удалённых ПК:
 * парсинг отчётов, генерация команд подключения через printui.dll.
 */

export interface PrinterItem {
  name: string;
  port: string;
  driverName: string;
  status: "ready" | "offline" | "error" | "paused";
  isDefault: boolean;
  isNetwork: boolean;
  location?: string;
  comment?: string;
}

export interface SmbShareItem {
  name: string;
  path: string;
  type: "disk" | "print" | "ipc" | "special";
  description?: string;
  isAdministrative: boolean;
}

export interface PrinterReport {
  computerName: string;
  timestamp: string;
  printers: PrinterItem[];
  shares: SmbShareItem[];
}

/**
 * Генерирует команду rundll32 printui.dll,PrintUIEntry для подключения сетевого принтера.
 * Пример локально: rundll32 printui.dll,PrintUIEntry /in /n "\\print-srv\HP-LaserJet"
 * Пример удалённо: rundll32 printui.dll,PrintUIEntry /ga /q /c\\pc2345 /n "\\print-srv\HP-LaserJet"
 */
export function generatePrintuiConnectCommand(printerPath: string, remoteHost?: string): string {
  const clean = printerPath.trim().replace(/["\r\n]/g, "");
  if (!clean) {
    throw new Error("[PrintUI] Printer path cannot be empty.");
  }
  const formatted = clean.startsWith("\\\\") ? clean : `\\\\${clean}`;
  const host = remoteHost?.trim();
  const isLocal = !host || host === "localhost" || host === "127.0.0.1" || host === ".";
  if (!isLocal) {
    return `rundll32 printui.dll,PrintUIEntry /ga /q /c\\\\${host} /n "${formatted}"`;
  }
  return `rundll32 printui.dll,PrintUIEntry /in /n "${formatted}"`;
}

/**
 * Генерирует команду установки принтера по умолчанию.
 * Пример локально: rundll32 printui.dll,PrintUIEntry /y /n "HP LaserJet Pro"
 * Пример удалённо: rundll32 printui.dll,PrintUIEntry /y /c\\pc2345 /n "HP LaserJet Pro"
 */
export function generatePrintuiDefaultCommand(printerName: string, remoteHost?: string): string {
  const clean = printerName.trim().replace(/["\r\n]/g, "");
  if (!clean) {
    throw new Error("[PrintUI] Printer name cannot be empty.");
  }
  const host = remoteHost?.trim();
  const isLocal = !host || host === "localhost" || host === "127.0.0.1" || host === ".";
  if (!isLocal) {
    return `rundll32 printui.dll,PrintUIEntry /y /c\\\\${host} /n "${clean}"`;
  }
  return `rundll32 printui.dll,PrintUIEntry /y /n "${clean}"`;
}

/**
 * Генерирует команду печати тестовой страницы.
 */
export function generatePrintuiTestPageCommand(printerName: string): string {
  const clean = printerName.trim().replace(/["\r\n]/g, "");
  if (!clean) {
    throw new Error("[PrintUI] Printer name cannot be empty.");
  }
  return `rundll32 printui.dll,PrintUIEntry /k /n "${clean}"`;
}

/**
 * Генерирует команду удаления сетевого принтера.
 */
export function generatePrintuiRemoveCommand(printerName: string): string {
  const clean = printerName.trim().replace(/["\r\n]/g, "");
  if (!clean) {
    throw new Error("[PrintUI] Printer name cannot be empty.");
  }
  return `rundll32 printui.dll,PrintUIEntry /dn /n "${clean}"`;
}

/**
 * Маппирует тип SMB-ресурса из WMI Win32_Share:
 * 0 / 2147483648 -> "disk"
 * 1 / 2147483649 -> "print"
 * 3 / 2147483651 -> "ipc"
 * 2 / иные >= 2147483648 -> "special"
 */
function mapShareType(rawType: unknown): SmbShareItem["type"] {
  if (typeof rawType === "string") {
    const lower = rawType.toLowerCase();
    if (lower === "disk" || lower === "print" || lower === "ipc" || lower === "special") {
      return lower;
    }
    const num = Number(rawType);
    if (!Number.isNaN(num)) {
      return mapShareType(num);
    }
    return "disk";
  }
  if (typeof rawType === "number") {
    if (rawType === 0 || rawType === 2147483648) return "disk";
    if (rawType === 1 || rawType === 2147483649) return "print";
    if (rawType === 3 || rawType === 2147483651) return "ipc";
    if (rawType === 2 || rawType >= 2147483648) return "special";
    return "special";
  }
  return "disk";
}

function mapPrinterStatus(rawStatus: unknown, rawPrinterStatusNum?: unknown): PrinterItem["status"] {
  if (typeof rawStatus === "string") {
    const lower = rawStatus.toLowerCase();
    if (lower === "offline" || lower === "error" || lower === "paused" || lower === "ready") {
      return lower;
    }
  }
  const num = Number(rawPrinterStatusNum);
  if (!Number.isNaN(num)) {
    if (num === 7) return "offline";
    if (num === 6 || num === 8) return "paused";
    if (num === 9) return "error";
    if (num >= 3 && num <= 5) return "ready";
  }
  return "ready";
}

/**
 * Парсит JSON (массив или одиночный объект) со списком принтеров.
 * Корректно обрабатывает любые типы портов (Local Port, USB, LPT, TCP/IP, WSD, \\srv\share)
 * и объединяет дубликаты по имени принтера без потери флага isDefault.
 */
export function parsePrinterOutput(raw: string): PrinterItem[] {
  if (!raw || typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const printerMap = new Map<string, PrinterItem>();
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const name = String(rec.name ?? rec.Name ?? "").trim();
      if (!name) continue;
      const port = String(rec.port ?? rec.PortName ?? "–");
      const driverName = String(rec.driverName ?? rec.DriverName ?? "–");
      const status = mapPrinterStatus(
        rec.status ?? rec.Status,
        rec.printerStatus ?? rec.PrinterStatus,
      );
      const isDefault = Boolean(rec.isDefault ?? rec.Default ?? rec.default);
      const isNetwork = Boolean(
        rec.isNetwork ??
        rec.Network ??
        (rec.Type === "Connection" || port.includes(".") || port.startsWith("\\\\") || name.startsWith("\\\\"))
      );
      const location = typeof rec.location === "string" ? rec.location : typeof rec.Location === "string" ? rec.Location : undefined;
      const comment = typeof rec.comment === "string" ? rec.comment : typeof rec.Comment === "string" ? rec.Comment : undefined;

      const key = name.toLowerCase();
      const existing = printerMap.get(key);
      if (existing) {
        // Объединяем поля: приоритет default=true, непустые поля
        existing.isDefault = existing.isDefault || isDefault;
        existing.isNetwork = existing.isNetwork || isNetwork;
        if (
          (existing.port === "–" && port !== "–") ||
          (existing.port === "Local Port" && port !== "–" && port !== "Local Port")
        ) {
          existing.port = port;
        }
        if ((existing.driverName === "–" || existing.driverName === "Сетевой принтер") && driverName !== "–") {
          existing.driverName = driverName;
        }
        if (existing.status === "ready" && status !== "ready") existing.status = status;
        if (!existing.location && location) existing.location = location;
        if (!existing.comment && comment) existing.comment = comment;
      } else {
        printerMap.set(key, {
          name,
          port,
          driverName,
          status,
          isDefault,
          isNetwork,
          location,
          comment,
        });
      }
    }
    return Array.from(printerMap.values());
  } catch {
    return [];
  }
}

/**
 * Парсит JSON (массив или одиночный объект) со списком SMB-ресурсов.
 */
export function parseSmbShareOutput(raw: string): SmbShareItem[] {
  if (!raw || typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const result: SmbShareItem[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const name = String(rec.name ?? rec.Name ?? "").trim();
      if (!name) continue;
      const path = String(rec.path ?? rec.Path ?? "");
      const rawType = rec.type ?? rec.Type;
      const mappedType = mapShareType(rawType);
      const isAdministrative = Boolean(
        rec.isAdministrative ??
        (name.endsWith("$") || (typeof rawType === "number" && rawType >= 2147483648))
      );
      result.push({
        name,
        path,
        type: mappedType,
        description: typeof rec.description === "string" ? rec.description : typeof rec.Description === "string" ? rec.Description : undefined,
        isAdministrative,
      });
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Парсит комбинированный отчёт { printers, shares } или одиночный список принтеров.
 */
export function parsePrinterAndShareReport(raw: string): { printers: PrinterItem[]; shares: SmbShareItem[] } {
  if (!raw || typeof raw !== "string") {
    return { printers: [], shares: [] };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { printers: [], shares: [] };
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") {
      const rec = parsed as Record<string, unknown>;
      if (!Array.isArray(parsed) && ("printers" in rec || "Printers" in rec || "shares" in rec || "Shares" in rec)) {
        const rawPrinters = rec.printers ?? rec.Printers ?? [];
        const rawShares = rec.shares ?? rec.Shares ?? [];
        return {
          printers: parsePrinterOutput(typeof rawPrinters === "string" ? rawPrinters : JSON.stringify(rawPrinters)),
          shares: parseSmbShareOutput(typeof rawShares === "string" ? rawShares : JSON.stringify(rawShares)),
        };
      }
      return {
        printers: parsePrinterOutput(trimmed),
        shares: [],
      };
    }
  } catch {
    // fallback
  }
  return { printers: [], shares: [] };
}
