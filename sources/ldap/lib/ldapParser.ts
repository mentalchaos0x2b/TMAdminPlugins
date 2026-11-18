/**
 * Утилиты для парсинга и форматирования атрибутов Active Directory / LDAP:
 * Distinguished Name (DN), иерархия подразделений (OU), флаги userAccountControl, группы безопасности.
 */

export interface ParsedDn {
  cn?: string;
  ou: string[];
  dc: string[];
  domain: string;
  path: string;
  raw: string;
}

export interface UacStatus {
  raw: number;
  isEnabled: boolean;
  isLocked: boolean;
  isPasswordRequired: boolean;
  isPasswordExpired: boolean;
  isDontExpirePassword: boolean;
  flagsList: string[];
}

export interface AdGroupInfo {
  raw: string;
  name: string;
  isSecurity: boolean;
  ou?: string;
}

export interface LdapComputerRecord {
  cn: string;
  distinguishedName: string;
  dnsHostName: string;
  operatingSystem: string;
  operatingSystemVersion: string;
  whenCreated: string;
  lastLogonTimestamp: string;
  userAccountControl: number;
  ipv4Address: string;
  description: string;
  memberOf: string[];
}

// Константы битовой маски userAccountControl
export const UAC_FLAGS = {
  ACCOUNTDISABLE: 0x0002,
  LOCKOUT: 0x0010,
  PASSWD_NOTREQD: 0x0020,
  PASSWD_CANT_CHANGE: 0x0040,
  WORKSTATION_TRUST_ACCOUNT: 0x1000,
  SERVER_TRUST_ACCOUNT: 0x2000,
  DONT_EXPIRE_PASSWORD: 0x10000,
  PASSWORD_EXPIRED: 0x800000,
} as const;

/**
 * Разбивает строку DN на компоненты с учётом экранирования обратным слэшем.
 */
function splitDnParts(dn: string): string[] {
  const parts: string[] = [];
  let current = "";
  let isEscaped = false;

  for (let i = 0; i < dn.length; i++) {
    const char = dn[i];
    if (isEscaped) {
      current += char;
      isEscaped = false;
    } else if (char === "\\") {
      isEscaped = true;
    } else if (char === ",") {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts;
}

/**
 * Парсит Distinguished Name (DN) в структурированный объект с иерархией OU и доменным именем.
 */
export function parseDistinguishedName(dn: string): ParsedDn {
  if (!dn || typeof dn !== "string") {
    return {
      ou: [],
      dc: [],
      domain: "",
      path: "",
      raw: "",
    };
  }

  const raw = dn.trim();
  const parts = splitDnParts(raw);

  let cn: string | undefined;
  const ou: string[] = [];
  const dc: string[] = [];

  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;

    const key = part.slice(0, eqIdx).trim().toUpperCase();
    const val = part.slice(eqIdx + 1).trim();

    if (key === "CN" && !cn) {
      cn = val;
    } else if (key === "OU") {
      ou.push(val);
    } else if (key === "DC") {
      dc.push(val);
    }
  }

  const domain = dc.join(".").toLowerCase();
  // Иерархия подразделений: от верхнего уровня к вложенному
  const path = [...ou].reverse().join(" / ");

  return {
    cn,
    ou,
    dc,
    domain,
    path,
    raw,
  };
}

/**
 * Расшифровывает битовую маску флагов userAccountControl учётной записи AD.
 */
export function parseUserAccountControl(flags: number): UacStatus {
  const raw = typeof flags === "number" ? flags : 0;
  const flagsList: string[] = [];

  const isDisabled = Boolean(raw & UAC_FLAGS.ACCOUNTDISABLE);
  const isLocked = Boolean(raw & UAC_FLAGS.LOCKOUT);
  const isPasswdNotReqd = Boolean(raw & UAC_FLAGS.PASSWD_NOTREQD);
  const isDontExpire = Boolean(raw & UAC_FLAGS.DONT_EXPIRE_PASSWORD);
  const isPwdExpired = Boolean(raw & UAC_FLAGS.PASSWORD_EXPIRED);

  if (isDisabled) {
    flagsList.push("Отключена (ACCOUNTDISABLE)");
  } else {
    flagsList.push("Включена (ACTIVE)");
  }

  if (isLocked) {
    flagsList.push("Заблокирована (LOCKOUT)");
  }

  if (isDontExpire) {
    flagsList.push("Бессрочный пароль");
  }

  if (isPwdExpired) {
    flagsList.push("Пароль истёк");
  }

  if (raw & UAC_FLAGS.WORKSTATION_TRUST_ACCOUNT) {
    flagsList.push("Рабочая станция");
  } else if (raw & UAC_FLAGS.SERVER_TRUST_ACCOUNT) {
    flagsList.push("Контроллер домена");
  }

  return {
    raw,
    isEnabled: !isDisabled,
    isLocked,
    isPasswordRequired: !isPasswdNotReqd,
    isPasswordExpired: isPwdExpired,
    isDontExpirePassword: isDontExpire,
    flagsList,
  };
}

/**
 * Преобразует список DN групп безопасности (memberOf) в читаемый формат с именами.
 */
export function formatGroupList(groups: string[]): AdGroupInfo[] {
  if (!Array.isArray(groups)) return [];

  return groups.map((raw) => {
    const parsed = parseDistinguishedName(raw);
    return {
      raw,
      name: parsed.cn || raw,
      isSecurity: true,
      ou: parsed.ou[0],
    };
  });
}

/**
 * Генерирует LDAP поисковый фильтр для компьютера.
 */
export function buildLdapComputerFilter(computerName: string): string {
  const clean = computerName.replace(/[\\*()/\0]/g, "").trim();
  return `(&(objectCategory=computer)(|(sAMAccountName=${clean}$)(cn=${clean})))`;
}

/**
 * Генерирует моковые данные AD для заданного имени компьютера.
 */
export function getMockLdapComputerRecord(computerName: string): LdapComputerRecord {
  const clean = (computerName || "srv-dc01").replace(/\..*$/, "").toUpperCase();
  const isDc = clean.includes("DC");

  return {
    cn: clean,
    distinguishedName: isDc
      ? `CN=${clean},OU=Domain Controllers,DC=corp,DC=local`
      : `CN=${clean},OU=Workstations,OU=HQ,DC=corp,DC=local`,
    dnsHostName: `${clean.toLowerCase()}.corp.local`,
    operatingSystem: isDc ? "Windows Server 2022 Datacenter" : "Windows 11 Pro Enterprise",
    operatingSystemVersion: isDc ? "21H2 (20348.2405)" : "23H2 (22631.3296)",
    whenCreated: "2024-03-15T09:20:00.000Z",
    lastLogonTimestamp: "2026-11-10T14:15:32.000Z",
    userAccountControl: isDc ? 0x2000 : 0x1000, // SERVER_TRUST vs WORKSTATION_TRUST
    ipv4Address: isDc ? "10.0.10.1" : "10.0.12.45",
    description: isDc
      ? "Основной контроллер домена (Primary Domain Controller)"
      : "Рабочая станция отдела системного администрирования",
    memberOf: isDc
      ? [
          "CN=Domain Controllers,CN=Users,DC=corp,DC=local",
          "CN=Enterprise Admins,CN=Users,DC=corp,DC=local",
          "CN=Schema Admins,CN=Users,DC=corp,DC=local",
        ]
      : [
          "CN=Domain Computers,CN=Users,DC=corp,DC=local",
          "CN=Workstations-VNC-Access,OU=Groups,OU=HQ,DC=corp,DC=local",
          "CN=GPO-LAPS-Enforced,OU=Policies,DC=corp,DC=local",
          "CN=IT-Support-RemoteAccess,OU=Groups,DC=corp,DC=local",
        ],
  };
}
