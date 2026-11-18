import { describe, it, expect } from "vitest";
import {
  generatePrintuiConnectCommand,
  generatePrintuiDefaultCommand,
  generatePrintuiTestPageCommand,
  generatePrintuiRemoveCommand,
  parsePrinterOutput,
  parseSmbShareOutput,
  parsePrinterAndShareReport,
} from "./printerReport";

describe("printerReport library", () => {
  describe("generatePrintui commands", () => {
    it("generates connect command with leading backslashes", () => {
      const cmd1 = generatePrintuiConnectCommand("\\\\print-srv\\HP-M428");
      expect(cmd1).toBe('rundll32 printui.dll,PrintUIEntry /in /n "\\\\print-srv\\HP-M428"');

      const cmd2 = generatePrintuiConnectCommand("print-srv\\Canon");
      expect(cmd2).toBe('rundll32 printui.dll,PrintUIEntry /in /n "\\\\print-srv\\Canon"');
    });

    it("throws on empty printer path", () => {
      expect(() => generatePrintuiConnectCommand("")).toThrow();
    });

    it("generates set default printer command", () => {
      const cmd = generatePrintuiDefaultCommand("HP LaserJet Pro");
      expect(cmd).toBe('rundll32 printui.dll,PrintUIEntry /y /n "HP LaserJet Pro"');
    });

    it("generates print test page command", () => {
      const cmd = generatePrintuiTestPageCommand("Canon C3530i");
      expect(cmd).toBe('rundll32 printui.dll,PrintUIEntry /k /n "Canon C3530i"');
    });

    it("generates remove printer command", () => {
      const cmd = generatePrintuiRemoveCommand("\\\\print-srv\\OldPrinter");
      expect(cmd).toBe('rundll32 printui.dll,PrintUIEntry /dn /n "\\\\print-srv\\OldPrinter"');
    });

    it("generates connect command for remote host (/ga /q /c\\\\host)", () => {
      const cmd = generatePrintuiConnectCommand("\\\\print-srv\\HP-M428", "pc2345");
      expect(cmd).toBe('rundll32 printui.dll,PrintUIEntry /ga /q /c\\\\pc2345 /n "\\\\print-srv\\HP-M428"');
    });

    it("generates default printer command for remote host (/y /c\\\\host)", () => {
      const cmd = generatePrintuiDefaultCommand("HP LaserJet Pro", "pc2345");
      expect(cmd).toBe('rundll32 printui.dll,PrintUIEntry /y /c\\\\pc2345 /n "HP LaserJet Pro"');
    });
  });

  describe("parsePrinterOutput", () => {
    it("parses valid JSON printers array", () => {
      const json = JSON.stringify([
        {
          Name: "HP LaserJet",
          PortName: "10.0.12.44",
          DriverName: "HP PCL-6",
          Default: true,
          status: "ready",
        },
      ]);
      const list = parsePrinterOutput(json);
      expect(list.length).toBe(1);
      expect(list[0].name).toBe("HP LaserJet");
      expect(list[0].port).toBe("10.0.12.44");
      expect(list[0].isDefault).toBe(true);
      expect(list[0].isNetwork).toBe(true);
    });

    it("parses single JSON object as a single printer item", () => {
      const json = JSON.stringify({
        Name: "Canon Office",
        PortName: "USB001",
        DriverName: "Canon UFR II",
        Default: false,
      });
      const list = parsePrinterOutput(json);
      expect(list.length).toBe(1);
      expect(list[0].name).toBe("Canon Office");
      expect(list[0].port).toBe("USB001");
      expect(list[0].isDefault).toBe(false);
      expect(list[0].isNetwork).toBe(false);
    });

    it("parses printers with Local Port, WSD, UNC and maps numeric PrinterStatus", () => {
      const json = JSON.stringify([
        {
          Name: "PDF-Creator",
          PortName: "Local Port",
          DriverName: "Generic / Text Only",
          PrinterStatus: 3,
          Default: false,
        },
        {
          Name: "\\\\print-srv\\Finance",
          PortName: "\\\\print-srv\\Finance",
          DriverName: "Kyocera",
          PrinterStatus: 7,
          Default: true,
        },
        {
          Name: "Scanner-Printer",
          PortName: "WSD-12345",
          DriverName: "Brother",
          PrinterStatus: 6,
          Default: false,
        },
      ]);
      const list = parsePrinterOutput(json);
      expect(list.length).toBe(3);
      expect(list[0].port).toBe("Local Port");
      expect(list[0].status).toBe("ready");
      expect(list[1].isNetwork).toBe(true);
      expect(list[1].status).toBe("offline");
      expect(list[1].isDefault).toBe(true);
      expect(list[2].port).toBe("WSD-12345");
      expect(list[2].status).toBe("paused");
    });

    it("deduplicates printers by case-insensitive name and preserves default flag", () => {
      const json = JSON.stringify([
        {
          Name: "HP-LaserJet",
          PortName: "Local Port",
          DriverName: "–",
          Default: false,
        },
        {
          Name: "hp-laserjet",
          PortName: "10.0.0.55",
          DriverName: "HP Universal Driver",
          Default: true,
        },
      ]);
      const list = parsePrinterOutput(json);
      expect(list.length).toBe(1);
      expect(list[0].name).toBe("HP-LaserJet");
      expect(list[0].port).toBe("10.0.0.55");
      expect(list[0].driverName).toBe("HP Universal Driver");
      expect(list[0].isDefault).toBe(true);
    });

    it("returns empty array on invalid input or empty string", () => {
      expect(parsePrinterOutput("")).toEqual([]);
      expect(parsePrinterOutput("not json")).toEqual([]);
    });
  });

  describe("parseSmbShareOutput", () => {
    it("parses valid JSON shares array and handles string types", () => {
      const json = JSON.stringify([
        {
          Name: "C$",
          Path: "C:\\",
          Type: "disk",
        },
      ]);
      const list = parseSmbShareOutput(json);
      expect(list.length).toBe(1);
      expect(list[0].name).toBe("C$");
      expect(list[0].type).toBe("disk");
      expect(list[0].isAdministrative).toBe(true);
    });

    it("parses single JSON object as a single share item", () => {
      const json = JSON.stringify({
        Name: "Docs",
        Path: "D:\\Docs",
        Type: "disk",
      });
      const list = parseSmbShareOutput(json);
      expect(list.length).toBe(1);
      expect(list[0].name).toBe("Docs");
      expect(list[0].path).toBe("D:\\Docs");
      expect(list[0].isAdministrative).toBe(false);
    });

    it("correctly maps numeric WMI Win32_Share Type codes", () => {
      const items = [
        { Name: "Data", Type: 0, Path: "D:\\Data" }, // Disk
        { Name: "AdminShare", Type: 2147483648, Path: "C:\\" }, // Disk admin
        { Name: "PrinterShare", Type: 1, Path: "" }, // Print
        { Name: "PrintAdmin", Type: 2147483649, Path: "" }, // Print admin
        { Name: "IPC$", Type: 3, Path: "" }, // IPC
        { Name: "IPCAdmin", Type: 2147483651, Path: "" }, // IPC admin
        { Name: "DeviceShare", Type: 2, Path: "" }, // Special / device
        { Name: "OtherSpecial", Type: 2147483650, Path: "" }, // Special
      ];
      const parsed = parseSmbShareOutput(JSON.stringify(items));
      expect(parsed[0].type).toBe("disk");
      expect(parsed[1].type).toBe("disk");
      expect(parsed[1].isAdministrative).toBe(true);
      expect(parsed[2].type).toBe("print");
      expect(parsed[3].type).toBe("print");
      expect(parsed[4].type).toBe("ipc");
      expect(parsed[5].type).toBe("ipc");
      expect(parsed[6].type).toBe("special");
      expect(parsed[7].type).toBe("special");
    });
  });

  describe("parsePrinterAndShareReport", () => {
    it("parses combined { printers, shares } JSON object", () => {
      const raw = JSON.stringify({
        printers: [
          {
            Name: "Kyocera Taskalfa",
            PortName: "192.168.1.100",
            DriverName: "KPDL",
          },
        ],
        shares: [
          {
            Name: "Public",
            Path: "D:\\Public",
            Type: 0,
          },
        ],
      });
      const res = parsePrinterAndShareReport(raw);
      expect(res.printers.length).toBe(1);
      expect(res.printers[0].name).toBe("Kyocera Taskalfa");
      expect(res.shares.length).toBe(1);
      expect(res.shares[0].name).toBe("Public");
      expect(res.shares[0].type).toBe("disk");
    });

    it("parses pure printers array as fallback", () => {
      const raw = JSON.stringify([
        {
          Name: "Zebra ZD420",
          PortName: "USB001",
          DriverName: "ZPL",
        },
      ]);
      const res = parsePrinterAndShareReport(raw);
      expect(res.printers.length).toBe(1);
      expect(res.printers[0].name).toBe("Zebra ZD420");
      expect(res.shares.length).toBe(0);
    });

    it("returns empty report for invalid or empty input", () => {
      expect(parsePrinterAndShareReport("")).toEqual({ printers: [], shares: [] });
      expect(parsePrinterAndShareReport("{ corrupted json }")).toEqual({ printers: [], shares: [] });
    });
  });
});
