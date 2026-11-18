import { describe, it, expect } from "vitest";
import {
  parseDistinguishedName,
  parseUserAccountControl,
  formatGroupList,
  buildLdapComputerFilter,
  getMockLdapComputerRecord,
  UAC_FLAGS,
} from "./ldapParser";

describe("ldapParser library", () => {
  describe("parseDistinguishedName", () => {
    it("correctly parses typical AD computer DN", () => {
      const dn = "CN=PC2345,OU=Workstations,OU=HQ,DC=corp,DC=local";
      const result = parseDistinguishedName(dn);

      expect(result.cn).toBe("PC2345");
      expect(result.ou).toEqual(["Workstations", "HQ"]);
      expect(result.dc).toEqual(["corp", "local"]);
      expect(result.domain).toBe("corp.local");
      expect(result.path).toBe("HQ / Workstations");
    });

    it("handles escaped commas in CN", () => {
      const dn = "CN=Doe\\, John,OU=Users,DC=corp,DC=local";
      const result = parseDistinguishedName(dn);

      expect(result.cn).toBe("Doe, John");
      expect(result.ou).toEqual(["Users"]);
      expect(result.domain).toBe("corp.local");
    });

    it("handles empty or malformed DN safely", () => {
      const empty = parseDistinguishedName("");
      expect(empty.domain).toBe("");
      expect(empty.ou).toEqual([]);
    });
  });

  describe("parseUserAccountControl", () => {
    it("detects active workstation", () => {
      const status = parseUserAccountControl(UAC_FLAGS.WORKSTATION_TRUST_ACCOUNT);
      expect(status.isEnabled).toBe(true);
      expect(status.isLocked).toBe(false);
      expect(status.flagsList).toContain("Включена (ACTIVE)");
      expect(status.flagsList).toContain("Рабочая станция");
    });

    it("detects disabled and locked account", () => {
      const status = parseUserAccountControl(
        UAC_FLAGS.ACCOUNTDISABLE | UAC_FLAGS.LOCKOUT | UAC_FLAGS.DONT_EXPIRE_PASSWORD,
      );
      expect(status.isEnabled).toBe(false);
      expect(status.isLocked).toBe(true);
      expect(status.isDontExpirePassword).toBe(true);
      expect(status.flagsList).toContain("Отключена (ACCOUNTDISABLE)");
      expect(status.flagsList).toContain("Заблокирована (LOCKOUT)");
    });
  });

  describe("formatGroupList", () => {
    it("formats array of DN groups into objects with readable names", () => {
      const dns = [
        "CN=Domain Admins,CN=Users,DC=corp,DC=local",
        "CN=Workstations-VNC,OU=Groups,OU=HQ,DC=corp,DC=local",
      ];
      const formatted = formatGroupList(dns);

      expect(formatted.length).toBe(2);
      expect(formatted[0].name).toBe("Domain Admins");
      expect(formatted[1].name).toBe("Workstations-VNC");
      expect(formatted[1].ou).toBe("Groups");
    });
  });

  describe("buildLdapComputerFilter", () => {
    it("generates sanitized LDAP filter for computer", () => {
      const filter = buildLdapComputerFilter("pc-admin-01");
      expect(filter).toBe("(&(objectCategory=computer)(|(sAMAccountName=pc-admin-01$)(cn=pc-admin-01)))");
    });

    it("strips harmful characters from input", () => {
      const filter = buildLdapComputerFilter("pc01)(uid=*");
      expect(filter).not.toContain("uid=*");
    });
  });

  describe("getMockLdapComputerRecord", () => {
    it("returns complete record for DC or workstation", () => {
      const pc = getMockLdapComputerRecord("PC2345");
      expect(pc.cn).toBe("PC2345");
      expect(pc.distinguishedName).toContain("PC2345");
      expect(pc.operatingSystem).toContain("Windows 11");
      expect(pc.memberOf.length).toBeGreaterThan(0);

      const dc = getMockLdapComputerRecord("SRV-DC01");
      expect(dc.distinguishedName).toContain("Domain Controllers");
      expect(dc.operatingSystem).toContain("Server");
    });
  });
});
