<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { defineBlock, useTarget, usePluginStore, useExec, useMessage } from "@tmadmin/sdk";
import {
  NInput,
  NButton,
  NTable,
  NTag,
  NIcon,
  NEmpty,
} from "naive-ui";
import {
  PrintOutline,
  FolderOpenOutline,
  RefreshOutline,
  HardwareChipOutline,
  // AddOutline,
  Star,
} from "@vicons/ionicons5";
import {
  parsePrinterAndShareReport,
  type PrinterItem,
  type SmbShareItem,
} from "../lib/printerReport";

defineBlock({
  title: "Принтеры и сетевые ресурсы",
  description: "Отчёт по подключённым сетевым/локальным принтерам и SMB-шарам на удалённом ПК",
  icon: "PrintOutline",
  defaultSize: { w: 16, h: 8 },
  minSize: { w: 10, h: 6 },
});

const target = useTarget();
const store = usePluginStore();
const exec = useExec();
const message = useMessage();

const HOST_REGEX = /^[a-zA-Z0-9._-]+$/;

const targetHostInput = ref<string>("");
const activeTab = ref<"printers" | "shares">("printers");
const isLoading = ref<boolean>(false);
const hasScanned = ref<boolean>(false);
const printers = ref<PrinterItem[]>([]);
const shares = ref<SmbShareItem[]>([]);
// const newPrinterPath = ref<string>("");

const currentHost = computed<string>(() => targetHostInput.value.trim() || target.value?.host || "");

function loadReport(host: string): void {
  const cleanHost = host.trim();
  if (!cleanHost) {
    printers.value = [];
    shares.value = [];
    hasScanned.value = false;
    return;
  }
  const cachedPrinters = store.get<PrinterItem[]>(`printers_${cleanHost}`);
  const cachedShares = store.get<SmbShareItem[]>(`shares_${cleanHost}`);
  if (cachedPrinters || cachedShares) {
    printers.value = cachedPrinters || [];
    shares.value = cachedShares || [];
    hasScanned.value = true;
  } else {
    printers.value = [];
    shares.value = [];
    hasScanned.value = false;
  }
}

const initialHost = target.value?.host || "";
targetHostInput.value = initialHost;
loadReport(initialHost);

onMounted(() => {
  const initial = target.value?.host || "";
  targetHostInput.value = initial;
  loadReport(initial);
});

watch(
  () => target.value?.host,
  (newVal) => {
    const val = newVal || "";
    targetHostInput.value = val;
    loadReport(val);
  },
);

async function handleRefresh(): Promise<void> {
  const host = currentHost.value;
  if (!host) {
    message.warning("Укажите имя или IP компьютера");
    return;
  }
  if (!HOST_REGEX.test(host)) {
    message.error("Недопустимый формат имени хоста или IP");
    return;
  }

  isLoading.value = true;
  message.info(`Опрос принтеров и сетевых ресурсов на ${host}...`);

  try {
    const psCommand = [
      `$h = '${host}';`,
      `$dict = @{};`,
      `try {`,
      `  $tcpPorts = @{};`,
      `  try {`,
      `    Get-WmiObject -Class Win32_TCPIPPrinterPort -ComputerName $h -ErrorAction SilentlyContinue | ForEach-Object {`,
      `      if ($_.Name -and $_.HostAddress) { $tcpPorts[$_.Name] = $_.HostAddress }`,
      `    }`,
      `  } catch {}`,
      `  Get-WmiObject -Class Win32_Printer -ComputerName $h -ErrorAction SilentlyContinue | ForEach-Object {`,
      `    if ($_.Name) {`,
      `      $pPort = $_.PortName;`,
      `      if ($pPort -and $tcpPorts.ContainsKey($pPort)) { $pPort = $tcpPorts[$pPort] };`,
      `      $dict[$_.Name.ToLower()] = @{`,
      `        Name = $_.Name;`,
      `        PortName = if ($pPort) { $pPort } else { "Local Port" };`,
      `        DriverName = if ($_.DriverName) { $_.DriverName } else { "–" };`,
      `        Default = [bool]$_.Default;`,
      `        Network = [bool]$_.Network;`,
      `        PrinterStatus = $_.PrinterStatus`,
      `      }`,
      `    }`,
      `  }`,
      `} catch {}`,
      `try {`,
      `  $reg = [Microsoft.Win32.RegistryKey]::OpenRemoteBaseKey('LocalMachine', $h);`,
      `  $pKey = $reg.OpenSubKey('SYSTEM\\CurrentControlSet\\Control\\Print\\Printers');`,
      `  if ($pKey) {`,
      `    foreach ($subName in $pKey.GetSubKeyNames()) {`,
      `      $kLow = $subName.ToLower();`,
      `      if (-not $dict.ContainsKey($kLow)) {`,
      `        $sub = $pKey.OpenSubKey($subName);`,
      `        if ($sub) {`,
      `          $pVal = $sub.GetValue('Port');`,
      `          $dVal = $sub.GetValue('Printer Driver');`,
      `          $dict[$kLow] = @{`,
      `            Name = $subName;`,
      `            PortName = if ($pVal) { [string]$pVal } else { "Local Port" };`,
      `            DriverName = if ($dVal) { [string]$dVal } else { "–" };`,
      `            Default = $false;`,
      `            Network = $false;`,
      `            PrinterStatus = 3`,
      `          }`,
      `        }`,
      `      }`,
      `    }`,
      `  }`,
      `} catch {`,
      `  try {`,
      `    $stdReg = [wmiclass]"\\\\$h\\root\\default:StdRegProv";`,
      `    $HKLM = 2147483650;`,
      `    $subKeys = ($stdReg.EnumKey($HKLM, "SYSTEM\\CurrentControlSet\\Control\\Print\\Printers")).sNames;`,
      `    if ($subKeys) {`,
      `      foreach ($sk in $subKeys) {`,
      `        $kLow = $sk.ToLower();`,
      `        if (-not $dict.ContainsKey($kLow)) {`,
      `          $pVal = ($stdReg.GetStringValue($HKLM, "SYSTEM\\CurrentControlSet\\Control\\Print\\Printers\\$sk", "Port")).sValue;`,
      `          $dVal = ($stdReg.GetStringValue($HKLM, "SYSTEM\\CurrentControlSet\\Control\\Print\\Printers\\$sk", "Printer Driver")).sValue;`,
      `          $dict[$kLow] = @{`,
      `            Name = $sk;`,
      `            PortName = if ($pVal) { [string]$pVal } else { "Local Port" };`,
      `            DriverName = if ($dVal) { [string]$dVal } else { "–" };`,
      `            Default = $false;`,
      `            Network = $false;`,
      `            PrinterStatus = 3`,
      `          }`,
      `        }`,
      `      }`,
      `    }`,
      `  } catch {}`,
      `}`,
      `try {`,
      `  $regU = [Microsoft.Win32.RegistryKey]::OpenRemoteBaseKey('Users', $h);`,
      `  foreach ($sid in $regU.GetSubKeyNames()) {`,
      `    if ($sid -match '^S-1-5-21-[\\d\\-]+$' -and $sid -notmatch '_Classes$') {`,
      `      $defDevice = "";`,
      `      $winKey = $regU.OpenSubKey("$sid\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows");`,
      `      if ($winKey) {`,
      `        $devStr = $winKey.GetValue('Device');`,
      `        if ($devStr) { $defDevice = ($devStr -split ',')[0].Trim() }`,
      `      };`,
      `      $connKey = $regU.OpenSubKey("$sid\\Printers\\Connections");`,
      `      if ($connKey) {`,
      `        foreach ($cSub in $connKey.GetSubKeyNames()) {`,
      `          $unc = "\\\\" + ($cSub -replace '^,+','' -replace ',','\\');`,
      `          $cLow = $unc.ToLower();`,
      `          $isDef = ($defDevice -and ($defDevice.ToLower() -eq $cLow -or $defDevice.ToLower() -eq $cSub.ToLower()));`,
      `          if ($dict.ContainsKey($cLow)) {`,
      `            if ($isDef) { $dict[$cLow]['Default'] = $true }`,
      `          } else {`,
      `            $dict[$cLow] = @{`,
      `              Name = $unc;`,
      `              PortName = $unc;`,
      `              DriverName = "Сетевой принтер";`,
      `              Default = [bool]$isDef;`,
      `              Network = $true;`,
      `              PrinterStatus = 3`,
      `            }`,
      `          }`,
      `        }`,
      `      };`,
      `      if ($defDevice) {`,
      `        $dLow = $defDevice.ToLower();`,
      `        if ($dict.ContainsKey($dLow)) { $dict[$dLow]['Default'] = $true }`,
      `      }`,
      `    }`,
      `  }`,
      `} catch {}`,
      `$s = @();`,
      `try {`,
      `  $s = @(Get-WmiObject -Class Win32_Share -ComputerName $h -ErrorAction SilentlyContinue | Select-Object Name,Path,Type,Description)`,
      `} catch {}`,
      `[PSCustomObject]@{ printers = @($dict.Values); shares = $s } | ConvertTo-Json -Depth 4`,
    ].join(" ");

    const res = await exec.pluginExec("powershell.exe", [
      "-NoProfile",
      "-Command",
      psCommand,
    ]);

    if (res && res.success === false) {
      throw new Error(res.stderr || "Ошибка выполнения команды PowerShell");
    }

    const raw = res?.stdout?.trim() || "";
    const report = parsePrinterAndShareReport(raw);
    printers.value = report.printers;
    shares.value = report.shares;
    hasScanned.value = true;

    await store.set(`printers_${host}`, report.printers, { persist: "temp" });
    await store.set(`shares_${host}`, report.shares, { persist: "temp" });

    if (report.printers.length === 0 && report.shares.length === 0) {
      message.info("Принтеры и сетевые ресурсы не найдены");
    } else {
      message.success(`Найдено принтеров: ${report.printers.length}, ресурсов: ${report.shares.length} (${host})`);
    }
  } catch (err) {
    printers.value = [];
    shares.value = [];
    hasScanned.value = true;
    const msg = err instanceof Error ? err.message : String(err);
    message.error(msg || "Ошибка опроса удаленного компьютера");
  } finally {
    isLoading.value = false;
  }
}

// async function launchRemoteService(): Promise<void> {
//   const host = currentHost.value;
//   if (!host) {
//     message.warning("Укажите имя или IP компьютера");
//     return;
//   }
//   try {
//     await exec.pluginSpawn("TMAdminRS/TMAdminRemoteService.exe", [host]);
//     message.success(`TMAdminRemoteService.exe запущен для ${host}`);
//   } catch {
//     message.info(`Запрос запуска TMAdminRemoteService.exe для ${host}`);
//   }
// }

// async function connectPrinter(): Promise<void> {
//   const path = newPrinterPath.value.trim();
//   if (!path) return;
//   const host = currentHost.value;
//   if (!host) {
//     message.warning("Укажите имя или IP компьютера");
//     return;
//   }
//   if (!HOST_REGEX.test(host)) {
//     message.error("Недопустимый формат имени хоста или IP");
//     return;
//   }

//   const cleanPath = path.replace(/["\r\n]/g, "").trim();
//   const formattedPath = cleanPath.startsWith("\\\\") ? cleanPath : `\\\\${cleanPath}`;
//   const safeHost = host.trim().replace(/'/g, "''");
//   const safePath = formattedPath.replace(/'/g, "''");
//   const cleanHost = host.trim().toLowerCase();
//   const isLocal = !cleanHost || cleanHost === "localhost" || cleanHost === "127.0.0.1" || cleanHost === "::1" || cleanHost === ".";

//   try {
//     let psCommand: string;
//     if (isLocal) {
//       psCommand = [
//         `$pPath = '${safePath}';`,
//         `$connected = $false;`,
//         `try {`,
//         `  (New-Object -ComObject WScript.Network).AddWindowsPrinterConnection($pPath);`,
//         `  $connected = $true;`,
//         `} catch {}`,
//         `if (-not $connected) {`,
//         `  $arg = "printui.dll,PrintUIEntry /in /q /n \`"$pPath\`"";`,
//         `  $proc = Start-Process -FilePath 'rundll32.exe' -ArgumentList $arg -Wait -PassThru -NoNewWindow;`,
//         `  if ($proc.ExitCode -eq 0) { $connected = $true }`,
//         `}`,
//         `if (-not $connected) {`,
//         `  throw "Не удалось подключить принтер $pPath локально";`,
//         `}`,
//       ].join(" ");
//     } else {
//       psCommand = [
//         `$target = '${safeHost}';`,
//         `$pPath = '${safePath}';`,
//         `$isLocalHost = ($target.ToLower() -eq $env:COMPUTERNAME.ToLower() -or $target -eq 'localhost' -or $target -eq '127.0.0.1');`,
//         `$connected = $false;`,
//         `if ($isLocalHost) {`,
//         `  try {`,
//         `    (New-Object -ComObject WScript.Network).AddWindowsPrinterConnection($pPath);`,
//         `    $connected = $true;`,
//         `  } catch {}`,
//         `  if (-not $connected) {`,
//         `    $arg = "printui.dll,PrintUIEntry /in /q /n \`"$pPath\`"";`,
//         `    $proc = Start-Process -FilePath 'rundll32.exe' -ArgumentList $arg -Wait -PassThru -NoNewWindow;`,
//         `    if ($proc.ExitCode -eq 0) { $connected = $true }`,
//         `  }`,
//         `} else {`,
//         `  $arg = "printui.dll,PrintUIEntry /ga /q /c\\\\$target /n \`"$pPath\`"";`,
//         `  $proc = Start-Process -FilePath 'rundll32.exe' -ArgumentList $arg -Wait -PassThru -NoNewWindow;`,
//         `  if ($proc.ExitCode -eq 0) {`,
//         `    $connected = $true;`,
//         `  } else {`,
//         `    try {`,
//         `      Add-Printer -ConnectionName $pPath -ComputerName $target -ErrorAction Stop;`,
//         `      $connected = $true;`,
//         `    } catch {`,
//         `      throw "Не удалось подключить принтер $pPath на $target (код $($proc.ExitCode)): $($_.Exception.Message)";`,
//         `    }`,
//         `  }`,
//         `  if ($connected) {`,
//         `    try {`,
//         `      Get-Service -ComputerName $target -Name Spooler -ErrorAction SilentlyContinue | Restart-Service -ErrorAction SilentlyContinue;`,
//         `    } catch {}`,
//         `  }`,
//         `}`,
//         `if (-not $connected) {`,
//         `  throw "Не удалось подключить принтер $pPath на $target";`,
//         `}`,
//       ].join(" ");
//     }

//     const res = await exec.pluginExec("powershell.exe", [
//       "-NoProfile",
//       "-Command",
//       psCommand,
//     ]);

//     if (!res || res.success === false || (res.exit_code !== undefined && res.exit_code !== 0)) {
//       throw new Error(res?.stderr || `Ошибка подключения принтера ${formattedPath}`);
//     }

//     const printerName = formattedPath.split("\\").pop() || formattedPath;
//     printers.value = [
//       {
//         name: printerName,
//         port: formattedPath,
//         driverName: "Сетевой принтер",
//         status: "ready",
//         isDefault: false,
//         isNetwork: true,
//       },
//       ...printers.value.filter((p) => p.name.toLowerCase() !== printerName.toLowerCase()),
//     ];
//     if (host) {
//       await store.set(`printers_${host}`, printers.value, { persist: "temp" });
//     }
//     newPrinterPath.value = "";
//     message.success(`Принтер "${printerName}" успешно подключен на ${host}`);
//   } catch (err) {
//     const msg = err instanceof Error ? err.message : String(err);
//     message.error(`Ошибка подключения принтера: ${msg}`);
//   }
// }

async function setDefaultPrinter(printer: PrinterItem): Promise<void> {
  const host = currentHost.value;
  if (!host) {
    message.warning("Укажите имя или IP компьютера");
    return;
  }
  if (!HOST_REGEX.test(host)) {
    message.error("Недопустимый формат имени хоста или IP");
    return;
  }

  const safeName = printer.name.replace(/'/g, "''");
  const safePort = (printer.port || "").replace(/'/g, "''");
  const cleanHost = host.trim().toLowerCase();
  const isLocal = !cleanHost || cleanHost === "localhost" || cleanHost === "127.0.0.1" || cleanHost === "::1" || cleanHost === ".";

  try {
    let psCommand: string;
    if (isLocal) {
      psCommand = [
        `$pName = '${safeName}';`,
        `try {`,
        `  $arg = "printui.dll,PrintUIEntry /y /n \`"$pName\`"";`,
        `  $proc = Start-Process -FilePath 'rundll32.exe' -ArgumentList $arg -Wait -PassThru -NoNewWindow;`,
        `  if ($proc.ExitCode -eq 0) { exit 0 }`,
        `} catch {};`,
        `try { (New-Object -ComObject WScript.Network).SetDefaultPrinter($pName); exit 0 } catch {};`,
        `try {`,
        `  $devStr = (Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Devices' -ErrorAction SilentlyContinue).$pName;`,
        `  $winspool = if ($devStr) { [string]$devStr } else { 'winspool,Ne00:' };`,
        `  Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows' -Name 'Device' -Value "$pName,$winspool" -ErrorAction Stop;`,
        `  exit 0;`,
        `} catch {};`,
        `throw "Не удалось назначить локальный принтер '$pName' по умолчанию";`,
      ].join(" ");
    } else {
      psCommand = [
        `$target = '${host}';`,
        `$pName = '${safeName}';`,
        `$pPort = '${safePort}';`,
        `if ($target.ToLower() -eq $env:COMPUTERNAME.ToLower() -or $target -eq 'localhost' -or $target -eq '127.0.0.1') {`,
        `  try {`,
        `    $arg = "printui.dll,PrintUIEntry /y /n \`"$pName\`"";`,
        `    $proc = Start-Process -FilePath 'rundll32.exe' -ArgumentList $arg -Wait -PassThru -NoNewWindow;`,
        `    if ($proc.ExitCode -eq 0) { exit 0 }`,
        `  } catch {};`,
        `  try { (New-Object -ComObject WScript.Network).SetDefaultPrinter($pName); exit 0 } catch {};`,
        `};`,
        `$updatedCount = 0;`,
        `try {`,
        `  $reg = [Microsoft.Win32.RegistryKey]::OpenRemoteBaseKey('Users', $target);`,
        `  foreach ($sid in $reg.GetSubKeyNames()) {`,
        `    if ($sid -match '^S-1-5-21-[\\d\\-]+$' -and $sid -notmatch '_Classes$') {`,
        `      $winKey = $reg.OpenSubKey("$sid\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows", $true);`,
        `      if ($winKey) {`,
        `        $resolved = $pName;`,
        `        $winspool = 'winspool,Ne00:';`,
        `        $devKey = $reg.OpenSubKey("$sid\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Devices");`,
        `        if ($devKey) {`,
        `          foreach ($dn in $devKey.GetValueNames()) {`,
        `            if ($dn.ToLower() -eq $pName.ToLower() -or ($pPort -and $dn.ToLower() -eq $pPort.ToLower())) {`,
        `              $resolved = $dn;`,
        `              $val = $devKey.GetValue($dn);`,
        `              if ($val) { $winspool = [string]$val };`,
        `              break;`,
        `            }`,
        `          }`,
        `          $devKey.Close();`,
        `        };`,
        `        if ($winspool -eq 'winspool,Ne00:') {`,
        `          $cur = $winKey.GetValue('Device');`,
        `          if ($cur -and ($cur -split ',').Count -ge 2) {`,
        `            $winspool = ($cur -split ',', 2)[1];`,
        `          }`,
        `        };`,
        `        $winKey.SetValue('Device', "$resolved,$winspool");`,
        `        $winKey.Flush();`,
        `        $winKey.Close();`,
        `        $updatedCount++;`,
        `      }`,
        `    }`,
        `  }`,
        `} catch {};`,
        `if ($updatedCount -eq 0) {`,
        `  try {`,
        `    $stdReg = [wmiclass]"\\\\$target\\root\\default:StdRegProv";`,
        `    $HKU = 2147483651;`,
        `    $subKeys = ($stdReg.EnumKey($HKU, "")).sNames;`,
        `    if ($subKeys) {`,
        `      foreach ($sid in $subKeys) {`,
        `        if ($sid -match '^S-1-5-21-[\\d\\-]+$' -and $sid -notmatch '_Classes$') {`,
        `          $winSub = "$sid\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows";`,
        `          $devSub = "$sid\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Devices";`,
        `          $devNames = ($stdReg.EnumValues($HKU, $devSub)).sNames;`,
        `          $resolved = $pName;`,
        `          $winspool = 'winspool,Ne00:';`,
        `          if ($devNames) {`,
        `            foreach ($dn in $devNames) {`,
        `              if ($dn.ToLower() -eq $pName.ToLower() -or ($pPort -and $dn.ToLower() -eq $pPort.ToLower())) {`,
        `                $resolved = $dn;`,
        `                $val = ($stdReg.GetStringValue($HKU, $devSub, $dn)).sValue;`,
        `                if ($val) { $winspool = [string]$val };`,
        `                break;`,
        `              }`,
        `            }`,
        `          };`,
        `          if ($winspool -eq 'winspool,Ne00:') {`,
        `            $cur = ($stdReg.GetStringValue($HKU, $winSub, "Device")).sValue;`,
        `            if ($cur -and ($cur -split ',').Count -ge 2) {`,
        `              $winspool = ($cur -split ',', 2)[1];`,
        `            }`,
        `          };`,
        `          $setRes = $stdReg.SetStringValue($HKU, $winSub, "Device", "$resolved,$winspool");`,
        `          if ($setRes.ReturnValue -eq 0) {`,
        `            $updatedCount++;`,
        `          }`,
        `        }`,
        `      }`,
        `    }`,
        `  } catch {}`,
        `};`,
        `if ($updatedCount -eq 0) {`,
        `  throw "Не удалось обновить принтер по умолчанию в реестре активных пользователей на $target";`,
        `};`,
      ].join(" ");
    }

    const res = await exec.pluginExec("powershell.exe", [
      "-NoProfile",
      "-Command",
      psCommand,
    ]);

    if (!res || res.success === false || (res.exit_code !== undefined && res.exit_code !== 0)) {
      throw new Error(res?.stderr || `Не удалось назначить принтер "${printer.name}" по умолчанию на ${host}`);
    }

    printers.value = printers.value.map((p) => ({ ...p, isDefault: p.name === printer.name }));
    if (host) {
      await store.set(`printers_${host}`, printers.value, { persist: "temp" });
    }
    message.success(`Принтер "${printer.name}" назначен по умолчанию`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    message.error(`Ошибка назначения принтера по умолчанию: ${msg}`);
  }
}
</script>

<template>
  <div class="smb-root" data-testid="smb-printers-block">
    <!-- Верхняя панель: выбор узла, кнопки обновления и TMAdminRS -->
    <div class="smb-top-bar">
      <div class="host-controls">
        <n-input
          v-model:value="targetHostInput"
          size="small"
          placeholder="ПК..."
          class="host-input"
          :input-props="({ 'data-testid': 'smb-target-input' } as Record<string, unknown>)"
          @keyup.enter="handleRefresh"
        >
          <template #prefix>
            <n-icon :component="HardwareChipOutline" />
          </template>
        </n-input>

        <n-button
          size="small"
          secondary
          :loading="isLoading"
          data-testid="smb-refresh-btn"
          @click="handleRefresh"
        >
          <template #icon>
            <n-icon :component="RefreshOutline" />
          </template>
          Обновить
        </n-button>

        <!-- ПОКА НЕ РАБОТАЕТ -->
        <!-- <n-button
          size="small"
          type="info"
          secondary
          data-testid="smb-tmadminrs-btn"
          @click="launchRemoteService"
        >
          TMAdminRS
        </n-button> -->
      </div>

      <!-- Вкладки -->
      <div class="tab-toggles">
        <n-button
          size="small"
          :type="activeTab === 'printers' ? 'primary' : 'default'"
          :secondary="activeTab === 'printers'"
          class="tab-btn"
          data-testid="smb-tab-printers"
          @click="activeTab = 'printers'"
        >
          <template #icon>
            <n-icon :component="PrintOutline" />
          </template>
          Принтеры ({{ printers.length }})
        </n-button>

        <n-button
          size="small"
          :type="activeTab === 'shares' ? 'primary' : 'default'"
          :secondary="activeTab === 'shares'"
          class="tab-btn"
          data-testid="smb-tab-shares"
          @click="activeTab = 'shares'"
        >
          <template #icon>
            <n-icon :component="FolderOpenOutline" />
          </template>
          Шары ({{ shares.length }})
        </n-button>
      </div>
    </div>

    <!-- Вкладка: Принтеры -->
    <div v-if="activeTab === 'printers'" class="tab-pane-content">
      <!-- Строка подключения принтера (ПОКА НЕ РАБОТАЕТ) -->
      <!-- <div class="add-printer-row">
        <n-input
          v-model:value="newPrinterPath"
          size="small"
          placeholder="\\print-srv\HP-M428..."
          class="printer-path-input"
          :input-props="({ 'data-testid': 'smb-new-printer-input' } as Record<string, unknown>)"
          @keyup.enter="connectPrinter"
        />
        <n-button
          type="primary"
          size="small"
          secondary
          data-testid="smb-connect-printer-btn"
          @click="connectPrinter"
        >
          <template #icon>
            <n-icon :component="AddOutline" />
          </template>
          Подключить
        </n-button>
      </div> -->

      <!-- Таблица принтеров или Empty-состояние -->
      <div class="table-container">
        <n-empty
          v-if="printers.length === 0"
          data-testid="smb-printers-empty"
          :description="!hasScanned ? 'Ничего нет — нажмите «Обновить» для сканирования' : 'Принтеры не найдены'"
          class="empty-state"
        />
        <n-table
          v-else
          size="small"
          bordered
          single-line
          class="smb-data-table"
          data-testid="smb-printers-table"
        >
          <thead>
            <tr>
              <th>Принтер</th>
              <th>Порт</th>
              <th>Драйвер</th>
              <th style="width: 90px; text-align: center;">Действия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in printers" :key="p.name">
              <td>
                <span class="printer-name">
                  <n-icon v-if="p.isDefault" :component="Star" class="star-icon" />
                  <b>{{ p.isDefault ? "★ " : "" }}{{ p.name }}</b>
                </span>
              </td>
              <td class="mono">{{ p.port }}</td>
              <td>{{ p.driverName }}</td>
              <td style="text-align: center;">
                <n-button
                  v-if="!p.isDefault"
                  size="tiny"
                  quaternary
                  type="primary"
                  @click="setDefaultPrinter(p)"
                >
                  По умолч.
                </n-button>
                <n-tag v-else size="tiny" type="success" :bordered="false">
                  По умолч.
                </n-tag>
              </td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </div>

    <!-- Вкладка: Сетевые шары -->
    <div v-else class="tab-pane-content">
      <div class="table-container">
        <n-empty
          v-if="shares.length === 0"
          data-testid="smb-shares-empty"
          :description="!hasScanned ? 'Ничего нет — нажмите «Обновить» для сканирования' : 'Сетевые ресурсы не найдены'"
          class="empty-state"
        />
        <n-table
          v-else
          size="small"
          bordered
          single-line
          class="smb-data-table"
          data-testid="smb-shares-table"
        >
          <thead>
            <tr>
              <th>Ресурс</th>
              <th>Путь</th>
              <th>Тип</th>
              <th>Описание</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in shares" :key="s.name">
              <td class="mono"><b>{{ s.name }}</b></td>
              <td class="mono">{{ s.path || "—" }}</td>
              <td>
                <n-tag size="tiny" :bordered="false">{{ s.type }}</n-tag>
              </td>
              <td>{{ s.description || "—" }}</td>
            </tr>
          </tbody>
        </n-table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.smb-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px;
  height: 100%;
  box-sizing: border-box;
  font-size: 12px;
  color: #e6edf3;
  overflow: hidden;
}

.smb-top-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.host-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.host-input {
  width: 140px;
}

.host-input :deep(input) {
  font-family: monospace;
}

.tab-toggles {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tab-btn {
  font-size: 11.5px;
}

.tab-pane-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  overflow: hidden;
}

.add-printer-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.printer-path-input {
  flex: 1;
}

.table-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  border-radius: 4px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 24px 0;
}

.smb-data-table {
  width: 100%;
  font-size: 11.5px;
}

.smb-data-table th {
  font-size: 11px;
  color: #8b949e;
}

.printer-name {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.star-icon {
  color: #f2c97d;
  font-size: 12px;
}

.mono {
  font-family: "JetBrains Mono", Consolas, monospace;
}
</style>
