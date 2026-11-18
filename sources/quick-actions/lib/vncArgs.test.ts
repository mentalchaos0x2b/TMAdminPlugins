import { describe, it, expect } from "vitest";
import {
  isValidVncHost,
  isValidVncPort,
  sanitizeVncPassword,
  buildVncArgs,
  buildTightVncProgsArgs,
  buildUltraVncArgs,
  buildRdpArgs,
  buildComputerManagementArgs,
  buildRestartCommand,
} from "./vncArgs";

describe("vncArgs library", () => {
  describe("isValidVncHost", () => {
    it("accepts valid hostnames, FQDNs and IPs", () => {
      expect(isValidVncHost("pc01")).toBe(true);
      expect(isValidVncHost("srv-dc01.corp.local")).toBe(true);
      expect(isValidVncHost("192.168.1.100")).toBe(true);
      expect(isValidVncHost("10.0.0.1")).toBe(true);
      expect(isValidVncHost("fe80::1")).toBe(true);
    });

    it("rejects malicious shell injection strings", () => {
      expect(isValidVncHost("pc01; rm -rf /")).toBe(false);
      expect(isValidVncHost("srv01 & calc.exe")).toBe(false);
      expect(isValidVncHost("srv01 | whoami")).toBe(false);
      expect(isValidVncHost("host>out.txt")).toBe(false);
      expect(isValidVncHost("host^evil")).toBe(false);
      expect(isValidVncHost("host`dir`")).toBe(false);
      expect(isValidVncHost("host$ENV")).toBe(false);
      expect(isValidVncHost("host%PATH%")).toBe(false);
      expect(isValidVncHost("host\\subdir")).toBe(false);
      expect(isValidVncHost("host with space")).toBe(false);
      expect(isValidVncHost("")).toBe(false);
    });
  });

  describe("isValidVncPort", () => {
    it("validates ports correctly", () => {
      expect(isValidVncPort(5900)).toBe(true);
      expect(isValidVncPort(1)).toBe(true);
      expect(isValidVncPort(65535)).toBe(true);
      expect(isValidVncPort(0)).toBe(false);
      expect(isValidVncPort(65536)).toBe(false);
      expect(isValidVncPort(-1)).toBe(false);
      expect(isValidVncPort(5900.5)).toBe(false);
    });
  });

  describe("sanitizeVncPassword", () => {
    it("strips harmful newline and quote characters", () => {
      expect(sanitizeVncPassword("secret")).toBe("secret");
      expect(sanitizeVncPassword('secret"with"quotes')).toBe("secretwithquotes");
      expect(sanitizeVncPassword("pass\nwith\rnewlines")).toBe("passwithnewlines");
      expect(sanitizeVncPassword("pass\\with\\slash")).toBe("passwithslash");
    });
  });

  describe("buildVncArgs", () => {
    it("builds standard VNC arguments with default port", () => {
      const args = buildVncArgs({ host: "pc-admin-01" });
      expect(args).toEqual(["-host=pc-admin-01", "-port=5900"]);
    });

    it("includes custom port and password", () => {
      const args = buildVncArgs({
        host: "10.0.1.20",
        port: 5901,
        password: "vncSecret123",
      });
      expect(args).toEqual(["-host=10.0.1.20", "-port=5901", "-password=vncSecret123"]);
    });

    it("includes viewOnly, fullscreen, and scale flags", () => {
      const args = buildVncArgs({
        host: "srv-dc01.corp.local",
        viewOnly: true,
        fullscreen: true,
        scale: 100,
      });
      expect(args).toEqual([
        "-host=srv-dc01.corp.local",
        "-port=5900",
        "-viewonly",
        "-fullscreen",
        "-scale=100",
      ]);
    });

    it("throws on invalid host or port", () => {
      expect(() => buildVncArgs({ host: "bad host & exit" })).toThrow(/Invalid host/);
      expect(() => buildVncArgs({ host: "srv01", port: 999999 })).toThrow(/Invalid port/);
    });
  });

  describe("buildTightVncProgsArgs", () => {
    it("builds TightVNC args with and without password", () => {
      expect(buildTightVncProgsArgs("pc01")).toEqual(["pc01"]);
      expect(buildTightVncProgsArgs("pc01", "secret123")).toEqual(["pc01", "-password=secret123"]);
    });

    it("throws on invalid host", () => {
      expect(() => buildTightVncProgsArgs("bad host; exit")).toThrow(/Invalid host/);
    });
  });

  describe("buildUltraVncArgs", () => {
    it("builds UltraVNC args with host, port and password", () => {
      expect(buildUltraVncArgs("pc01")).toEqual(["pc01:5900"]);
      expect(buildUltraVncArgs("pc01", 5901)).toEqual(["pc01:5901"]);
      expect(buildUltraVncArgs("pc01", 5900, "pass123")).toEqual(["pc01:5900", "-password", "pass123"]);
    });

    it("throws on invalid host or port", () => {
      expect(() => buildUltraVncArgs("bad host; exit")).toThrow(/Invalid host/);
      expect(() => buildUltraVncArgs("pc01", 99999)).toThrow(/Invalid port/);
    });
  });

  describe("buildRdpArgs", () => {
    it("builds standard mstsc arguments", () => {
      expect(buildRdpArgs("pc01.corp.local")).toEqual(["/v:pc01.corp.local"]);
      expect(buildRdpArgs("pc01.corp.local", 3390)).toEqual(["/v:pc01.corp.local:3390"]);
    });

    it("throws on invalid host", () => {
      expect(() => buildRdpArgs("pc01; calc")).toThrow();
    });
  });

  describe("buildComputerManagementArgs and buildRestartCommand", () => {
    it("builds compmgmt argument", () => {
      expect(buildComputerManagementArgs("srv-dc01")).toEqual(["/computer:srv-dc01"]);
    });

    it("builds safe restart command", () => {
      const cmd = buildRestartCommand("srv-dc01", 15);
      expect(cmd).toContain("shutdown.exe /r /m \\\\srv-dc01 /t 15");
    });
  });

  describe("splitCommandArgs and cleanQuotes from actions.ts", () => {
    it("splits command args respecting quoted substrings with spaces", async () => {
      const { splitCommandArgs } = await import("./actions");
      expect(splitCommandArgs("")).toEqual([]);
      expect(splitCommandArgs("   ")).toEqual([]);
      expect(splitCommandArgs("-a -b --c")).toEqual(["-a", "-b", "--c"]);
      expect(splitCommandArgs('-path "C:\\Program Files\\App" -v')).toEqual([
        "-path",
        "C:\\Program Files\\App",
        "-v",
      ]);
      expect(splitCommandArgs("/v:'srv-01' /f")).toEqual(["/v:srv-01", "/f"]);
    });

    it("cleans outer quotes properly", async () => {
      const { cleanQuotes } = await import("./actions");
      expect(cleanQuotes("")).toBe("");
      expect(cleanQuotes('"C:\\Tools\\Victoria.exe"')).toBe("C:\\Tools\\Victoria.exe");
      expect(cleanQuotes("'C:\\Tools\\Victoria.exe'")).toBe("C:\\Tools\\Victoria.exe");
      expect(cleanQuotes("C:\\Tools\\Victoria.exe")).toBe("C:\\Tools\\Victoria.exe");
    });
  });
});
