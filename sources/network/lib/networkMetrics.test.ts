import { describe, it, expect } from "vitest";
import {
  calculatePingStats,
  appendRttPoint,
  formatRtt,
  formatLoss,
  formatJitter,
  formatTimestamp,
  computeSvgChartData,
} from "./networkMetrics";

describe("networkMetrics", () => {
  describe("calculatePingStats", () => {
    it("returns idle stats for empty history", () => {
      const stats = calculatePingStats([]);
      expect(stats.total).toBe(0);
      expect(stats.received).toBe(0);
      expect(stats.lost).toBe(0);
      expect(stats.lossPercent).toBe(0);
      expect(stats.min).toBeNull();
      expect(stats.max).toBeNull();
      expect(stats.avg).toBeNull();
      expect(stats.jitter).toBeNull();
      expect(stats.status).toBe("idle");
    });

    it("calculates correct statistics for a single successful packet", () => {
      const stats = calculatePingStats([15]);
      expect(stats.total).toBe(1);
      expect(stats.received).toBe(1);
      expect(stats.lost).toBe(0);
      expect(stats.lossPercent).toBe(0);
      expect(stats.min).toBe(15);
      expect(stats.max).toBe(15);
      expect(stats.avg).toBe(15);
      expect(stats.jitter).toBeNull(); // Less than 2 packets
      expect(stats.status).toBe("online");
    });

    it("calculates min, max, avg, jitter and loss for multiple packets", () => {
      // 4 packets: 10, 20, 15, 25 -> sum = 70, avg = 17.5 -> round = 18
      // consecutive diffs: |20-10|=10, |15-20|=5, |25-15|=10 -> sum = 25 / 3 = 8.3
      const stats = calculatePingStats([10, 20, 15, 25]);
      expect(stats.total).toBe(4);
      expect(stats.received).toBe(4);
      expect(stats.lost).toBe(0);
      expect(stats.lossPercent).toBe(0);
      expect(stats.min).toBe(10);
      expect(stats.max).toBe(25);
      expect(stats.avg).toBe(18);
      expect(stats.jitter).toBe(8.3);
      expect(stats.status).toBe("online");
    });

    it("handles lost packets (timeouts) and high loss degradation", () => {
      // 10 packets, 3 lost -> 30% loss
      const history = [12, null, 14, null, 15, 13, null, 16, 14, 15];
      const stats = calculatePingStats(history);
      expect(stats.total).toBe(10);
      expect(stats.received).toBe(7);
      expect(stats.lost).toBe(3);
      expect(stats.lossPercent).toBe(30);
      expect(stats.min).toBe(12);
      expect(stats.max).toBe(16);
      expect(stats.status).toBe("degraded");
    });

    it("marks status as offline if 100% packets lost", () => {
      const stats = calculatePingStats([null, null, null]);
      expect(stats.total).toBe(3);
      expect(stats.received).toBe(0);
      expect(stats.lost).toBe(3);
      expect(stats.lossPercent).toBe(100);
      expect(stats.min).toBeNull();
      expect(stats.max).toBeNull();
      expect(stats.avg).toBeNull();
      expect(stats.jitter).toBeNull();
      expect(stats.status).toBe("offline");
    });

    it("marks status as degraded if average latency is very high (>150ms)", () => {
      const stats = calculatePingStats([180, 220, 190]);
      expect(stats.status).toBe("degraded");
    });
  });

  describe("appendRttPoint", () => {
    it("appends points up to limit without dropping", () => {
      let buf: (number | null)[] = [];
      for (let i = 1; i <= 5; i++) {
        buf = appendRttPoint(buf, i, 5);
      }
      expect(buf).toEqual([1, 2, 3, 4, 5]);
    });

    it("trims oldest points when exceeding maxPoints (default 60)", () => {
      let buf: (number | null)[] = [];
      for (let i = 1; i <= 65; i++) {
        buf = appendRttPoint(buf, i, 60);
      }
      expect(buf.length).toBe(60);
      expect(buf[0]).toBe(6);
      expect(buf[59]).toBe(65);
    });

    it("accepts null (timeout) points", () => {
      const buf = appendRttPoint([10, 20], null);
      expect(buf).toEqual([10, 20, null]);
    });
  });

  describe("formatting helpers", () => {
    it("formats RTT ms", () => {
      expect(formatRtt(14.4)).toBe("14 мс");
      expect(formatRtt(null, "Таймаут")).toBe("Таймаут");
      expect(formatRtt(null)).toBe("–");
      expect(formatRtt(undefined)).toBe("–");
    });

    it("formats loss %", () => {
      expect(formatLoss(0)).toBe("0%");
      expect(formatLoss(15)).toBe("15%");
      expect(formatLoss(null)).toBe("0%");
    });

    it("formats jitter", () => {
      expect(formatJitter(2.5)).toBe("2.5 мс");
      expect(formatJitter(null)).toBe("–");
      expect(formatJitter(undefined)).toBe("–");
    });

    it("formats timestamp", () => {
      expect(formatTimestamp(undefined)).toBe("–");
      expect(formatTimestamp("invalid-date")).toBe("–");
      const d = new Date(2026, 10, 10, 14, 30, 45);
      expect(formatTimestamp(d)).toMatch(/14:30:45/);
    });
  });

  describe("computeSvgChartData", () => {
    it("handles empty history with fallback grid", () => {
      const data = computeSvgChartData([], 600, 200);
      expect(data.points).toEqual([]);
      expect(data.polylinePoints).toBe("");
      expect(data.areaPath).toBe("");
      expect(data.gridLines.length).toBe(3);
    });

    it("generates points and SVG paths for valid history", () => {
      const data = computeSvgChartData([10, 20, 15], 600, 200);
      expect(data.points.length).toBe(3);
      expect(data.points[0]!.rtt).toBe(10);
      expect(data.points[1]!.rtt).toBe(20);
      expect(data.points[2]!.rtt).toBe(15);
      expect(data.polylinePoints).toBeTruthy();
      expect(data.areaPath).toContain("M ");
      expect(data.areaPath).toContain("Z");
      expect(data.maxY).toBeGreaterThanOrEqual(25);
    });

    it("handles history with timeouts without crashing", () => {
      const data = computeSvgChartData([10, null, 15], 600, 200);
      expect(data.points.length).toBe(3);
      expect(data.points[1]!.rtt).toBeNull();
      // Polyline coordinates only connect valid numeric points
      expect(data.polylinePoints.split(" ").length).toBe(2);
    });
  });
});
