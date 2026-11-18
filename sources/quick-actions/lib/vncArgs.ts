/**
 * Валидация и формирование аргументов запуска утилит удалённого доступа
 * (TightVNC.exe, UltraVNC.exe, PSX.exe, WizTree64.exe, RDP, CompMgmt).
 */

export interface VncLaunchOptions {
  host: string;
  port?: number;
  password?: string | null;
  viewOnly?: boolean;
  fullscreen?: boolean;
  scale?: number;
}

const SHELL_INJECTION_REGEX = /[&|;><^"'`$%\s\\]/;
const HOSTNAME_OR_IP_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$/;
const IPV6_REGEX = /^\[?[a-fA-F0-9:]+\]?$/;

export function isValidVncHost(host: string): boolean {
  if (!host || typeof host !== "string") return false;
  const trimmed = host.trim();
  if (trimmed.length === 0 || trimmed.length > 255) return false;
  if (SHELL_INJECTION_REGEX.test(trimmed)) return false;
  return HOSTNAME_OR_IP_REGEX.test(trimmed) || IPV6_REGEX.test(trimmed);
}

export function isValidVncPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function sanitizeVncPassword(password: string): string {
  return password.replace(/[\r\n"'\\]/g, "");
}

export function buildTightVncProgsArgs(host: string, password?: string | null): string[] {
  const cleanHost = host.trim();
  if (!isValidVncHost(cleanHost)) {
    throw new Error(`[VNC] Invalid host: "${host}"`);
  }
  if (password && password.length > 0) {
    return [cleanHost, `-password=${sanitizeVncPassword(password)}`];
  }
  return [cleanHost];
}

export function buildUltraVncArgs(host: string, port = 5900, password?: string | null): string[] {
  const cleanHost = host.trim();
  if (!isValidVncHost(cleanHost)) {
    throw new Error(`[UltraVNC] Invalid host: "${host}"`);
  }
  if (!isValidVncPort(port)) {
    throw new Error(`[UltraVNC] Invalid port: ${port}`);
  }
  const targetStr = `${cleanHost}:${port}`;
  if (password && password.length > 0) {
    return [targetStr, "-password", sanitizeVncPassword(password)];
  }
  return [targetStr];
}

export function buildVncArgs(options: VncLaunchOptions): string[] {
  if (!options || typeof options.host !== "string") {
    throw new Error("[VNC] Host is required.");
  }

  const cleanHost = options.host.trim();
  if (!isValidVncHost(cleanHost)) {
    throw new Error(`[VNC] Invalid host or IP address format: "${options.host}"`);
  }

  const port = options.port ?? 5900;
  if (!isValidVncPort(port)) {
    throw new Error(`[VNC] Invalid port: ${options.port}. Port must be between 1 and 65535.`);
  }

  const args: string[] = [`-host=${cleanHost}`, `-port=${port}`];

  if (options.password && options.password.length > 0) {
    args.push(`-password=${sanitizeVncPassword(options.password)}`);
  }
  if (options.viewOnly) args.push("-viewonly");
  if (options.fullscreen) args.push("-fullscreen");
  if (typeof options.scale === "number" && options.scale > 0 && options.scale <= 500) {
    args.push(`-scale=${Math.round(options.scale)}`);
  }

  return args;
}

export function buildRdpArgs(host: string, port?: number): string[] {
  if (!isValidVncHost(host)) {
    throw new Error(`[RDP] Invalid host: "${host}"`);
  }
  const cleanHost = host.trim();
  if (port && isValidVncPort(port) && port !== 3389) {
    return [`/v:${cleanHost}:${port}`];
  }
  return [`/v:${cleanHost}`];
}

export function buildComputerManagementArgs(host: string): string[] {
  if (!isValidVncHost(host)) {
    throw new Error(`[CompMgmt] Invalid host: "${host}"`);
  }
  return [`/computer:${host.trim()}`];
}

export function buildRestartCommand(host: string, delaySec = 30): string {
  if (!isValidVncHost(host)) {
    throw new Error(`[Restart] Invalid host: "${host}"`);
  }
  const delay = Math.max(0, Math.min(300, Math.round(delaySec)));
  return `shutdown.exe /r /m \\\\${host.trim()} /t ${delay} /c "Перезагрузка инициирована администратором через TMAdmin"`;
}
