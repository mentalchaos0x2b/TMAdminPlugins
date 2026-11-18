import { describe, it, expect } from "vitest";
import {
  fileTimeToDate,
  dateToFileTime,
  maskPassword,
  formatLapsDate,
  calculateLapsExpiration,
  parseLapsOutput,
} from "./lapsFormatter";

describe("lapsFormatter library", () => {
  describe("fileTime conversions", () => {
    it("converts known Windows FileTime to Date and back", () => {
      const testDate = new Date("2026-11-24T12:00:00.000Z");
      const fileTime = dateToFileTime(testDate);
      expect(fileTime).toBeGreaterThan(130000000000000000n);

      const convertedDate = fileTimeToDate(fileTime);
      expect(convertedDate.getTime()).toBe(testDate.getTime());
    });

    it("handles zero or invalid fileTime safely", () => {
      expect(fileTimeToDate(0).getTime()).toBe(0);
      expect(fileTimeToDate("0").getTime()).toBe(0);
      expect(fileTimeToDate("invalid").getTime()).toBe(0);
    });

    it("formats laps date nicely", () => {
      const d = new Date(2026, 10, 24, 14, 30);
      expect(formatLapsDate(d)).toBe("24.11.2026 14:30");
      expect(formatLapsDate(new Date(0))).toBe("Не задано");
    });
  });

  describe("maskPassword", () => {
    it("masks all characters by default", () => {
      expect(maskPassword("MySecretPass")).toBe("••••••••••••");
      expect(maskPassword("")).toBe("");
    });

    it("reveals specified number of initial characters", () => {
      expect(maskPassword("AdminPass123", 4)).toBe("Admi••••••••");
    });
  });

  describe("calculateLapsExpiration", () => {
    const fixedNow = new Date("2026-11-10T12:00:00.000Z");

    it("identifies valid password with remaining days", () => {
      const expirationDate = new Date("2026-11-24T12:00:00.000Z");
      const result = calculateLapsExpiration(expirationDate, fixedNow);

      expect(result.isExpired).toBe(false);
      expect(result.status).toBe("valid");
      expect(result.daysRemaining).toBe(14);
      expect(result.humanRemaining).toBe("14 дн.");
    });

    it("identifies password expiring soon (< 24 hours)", () => {
      const expirationDate = new Date("2026-11-10T18:00:00.000Z");
      const result = calculateLapsExpiration(expirationDate, fixedNow);

      expect(result.isExpired).toBe(false);
      expect(result.status).toBe("expiring_soon");
      expect(result.humanRemaining).toBe("Менее 6 ч.");
    });

    it("identifies expired password", () => {
      const expiredDate = new Date("2026-11-01T12:00:00.000Z");
      const result = calculateLapsExpiration(expiredDate, fixedNow);

      expect(result.isExpired).toBe(true);
      expect(result.status).toBe("expired");
      expect(result.humanRemaining).toBe("Пароль истёк");
    });
  });

  describe("parseLapsOutput", () => {
    it("parses JSON stdout from laps.exe", () => {
      const stdout = '{ "target": "pc5700", "password": "WFz81Ir8", "expires": "2026-11-14 08:08:59", "reset": false }';
      const parsed = parseLapsOutput(stdout);
      expect(parsed.target).toBe("pc5700");
      expect(parsed.password).toBe("WFz81Ir8");
      expect(parsed.expiresRaw).toBe("2026-11-14 08:08:59");
      expect(parsed.reset).toBe(false);
      expect(parsed.expirationDate.getFullYear()).toBe(2026);
    });

    it("throws on empty or missing password", () => {
      expect(() => parseLapsOutput("")).toThrow(/Пустой ответ/);
      expect(() => parseLapsOutput('{ "target": "pc5700", "password": "" }')).toThrow(/не найден/);
    });
  });
});
