export interface BlockActionItem {
  id: string;
  name: string;
  command: string;
  args?: string;
  cwd?: string;
  variant?: "default" | "vnc" | "warn" | "danger";
  isBuiltin?: boolean;
  testId?: string;
}

export function splitCommandArgs(rawArgs: string): string[] {
  const trimmed = rawArgs.trim();
  if (!trimmed) return [];

  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (!inQuotes && (char === '"' || char === "'")) {
      inQuotes = true;
      quoteChar = char;
    } else if (inQuotes && char === quoteChar) {
      inQuotes = false;
      quoteChar = "";
    } else if (!inQuotes && /\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

export function cleanQuotes(str?: string): string {
  if (!str) return "";
  let res = str.trim();
  if (
    (res.startsWith('"') && res.endsWith('"') && res.length >= 2) ||
    (res.startsWith("'") && res.endsWith("'") && res.length >= 2)
  ) {
    res = res.slice(1, -1).trim();
  }
  return res;
}

export const DEFAULT_VNC_ACTIONS: readonly BlockActionItem[] = [
  { id: "tightvnc", name: "TightVNC", command: "TightVNC.exe", args: "{host}", variant: "vnc", isBuiltin: true, testId: "vnc-connect-btn" },
  { id: "ultravnc", name: "UltraVNC", command: "UltraVNC.exe", args: "{host}", variant: "vnc", isBuiltin: true, testId: "vnc-ultravnc-btn" },
  { id: "rdp", name: "RDP", command: "mstsc.exe", args: "/v:{host}", variant: "default", isBuiltin: true, testId: "vnc-rdp-btn" },
  { id: "psexec", name: "PSExec", command: "PSX.exe", args: "\\\\{host} cmd", variant: "default", isBuiltin: true, testId: "vnc-psexec-btn" },
  { id: "compmgmt", name: "Управление", command: "compmgmt.msc", args: "/computer:\\\\{host}", variant: "default", isBuiltin: true, testId: "vnc-compmgmt-btn" },
  { id: "disk-c", name: "Диск C$", command: "explorer.exe", args: "\\\\{host}\\c$", variant: "default", isBuiltin: true, testId: "vnc-disk-c-btn" },
  { id: "disk-d", name: "Диск D$", command: "explorer.exe", args: "\\\\{host}\\d$", variant: "default", isBuiltin: true, testId: "vnc-disk-d-btn" },
  { id: "wiztree-c", name: "WizTree C", command: "WizTree/WizTree64.exe", args: "\\\\{host}\\c$", variant: "default", isBuiltin: true, testId: "vnc-wiztree-c-btn" },
  { id: "wiztree-d", name: "WizTree D", command: "WizTree/WizTree64.exe", args: "\\\\{host}\\d$", variant: "default", isBuiltin: true, testId: "vnc-wiztree-d-btn" },
  { id: "spooler", name: "Очистить печать", command: "PSX.exe", args: '\\\\{host} cmd /c net stop spooler & del /Q /F /S "%systemroot%\\System32\\Spool\\Printers\\*.*" & net start spooler', variant: "warn", isBuiltin: true, testId: "vnc-spooler-btn" },
  { id: "reboot", name: "Перезагрузка", command: "shutdown.exe", args: "/r /m \\\\{host} /t 0", variant: "danger", isBuiltin: true, testId: "vnc-reboot-btn" },
];
