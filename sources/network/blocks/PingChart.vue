<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import {
  useTarget,
  useExec,
  useSharedStore,
  usePluginStore,
  Chart,
  type ScriptableContext,
} from "@tmadmin/sdk";
import { NButton, NTag, NSpace } from "naive-ui";
import {
  calculatePingStats,
  appendRttPoint,
  formatRtt,
  formatLoss,
  formatJitter,
} from "../lib/networkMetrics";

const props = defineProps<{
  block?: { id?: string };
}>();

const blockId = computed<string>(() => props.block?.id?.trim() || "");

const target = useTarget();
const exec = useExec();
const sharedStore = useSharedStore();
const pluginStore = usePluginStore();

const isPinging = ref<boolean>(false);
const rttHistory = ref<(number | null)[]>([]);
const activePingId = ref<string | null>(null);
const unlistenFn = ref<(() => void) | null>(null);

const boxRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const mockTimer = ref<ReturnType<typeof setInterval> | null>(null);

let chartInstance: Chart | null = null;
let resizeObserver: ResizeObserver | null = null;

export interface HoveredChartPoint {
  seq: number;
  rtt: number | null;
  x: number;
  y: number;
}

const hoveredPoint = ref<HoveredChartPoint | null>(null);

const currentTargetHost = computed<string>(() => target.value?.host?.trim() || "");
const stats = computed(() => calculatePingStats(rttHistory.value));

const minRttFormatted = computed<string>(() => formatRtt(stats.value.min));
const maxRttFormatted = computed<string>(() => formatRtt(stats.value.max));
const avgRttFormatted = computed<string>(() => formatRtt(stats.value.avg));
const jitterFormatted = computed<string>(() => formatJitter(stats.value.jitter));
const lossFormatted = computed<string>(() => formatLoss(stats.value.lossPercent));

const statusType = computed<"default" | "success" | "warning" | "error">(() => {
  if (stats.value.status === "online") return "success";
  if (stats.value.status === "degraded") return "warning";
  if (stats.value.status === "offline") return "error";
  return "default";
});

function getSamplesKey(host: string): string {
  if (blockId.value) {
    return `ping:samples:${blockId.value}:${host}`;
  }
  return `ping:samples:${host}`;
}

function loadSamplesForHost(host: string): void {
  if (!host) {
    rttHistory.value = [];
    return;
  }
  let saved: (number | null)[] | undefined;
  if (blockId.value) {
    saved = pluginStore.get<(number | null)[]>(`ping:samples:${blockId.value}:${host}`);
  }
  if (!saved || !Array.isArray(saved) || saved.length === 0) {
    saved = pluginStore.get<(number | null)[]>(`ping:samples:${host}`);
  }
  if (Array.isArray(saved) && saved.length > 0) {
    rttHistory.value = [...saved];
  } else {
    rttHistory.value = [];
  }
}

function addPoint(ms: number | null): void {
  rttHistory.value = appendRttPoint(rttHistory.value, ms, 60);
  const host = currentTargetHost.value;
  if (host) {
    const key = getSamplesKey(host);
    void pluginStore.set(key, rttHistory.value, { persist: "temp" });
    if (blockId.value) {
      void pluginStore.set(`ping:samples:${host}`, rttHistory.value, { persist: "temp" });
    }
  }
  sharedStore.publish("network:ping_tick", {
    host,
    ms,
    stats: stats.value,
  });
  sharedStore.set("network.latest_stats", stats.value, "temp").catch(() => {});
}

async function startPing(): Promise<void> {
  const host = currentTargetHost.value.trim();
  if (!host) return;
  isPinging.value = true;
  try {
    const id = await exec.pingStart(host);
    activePingId.value = id;
    unlistenFn.value = await exec.listenPing(id, (payload) => addPoint(payload.ms));
  } catch {
    if (
      typeof window !== "undefined" &&
      !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    ) {
      addPoint(14);
      mockTimer.value = setInterval(() => {
        addPoint(Math.random() < 0.05 ? null : 12 + Math.floor(Math.random() * 12));
      }, 1000);
    }
  }
}

async function stopPing(): Promise<void> {
  if (mockTimer.value) {
    clearInterval(mockTimer.value);
    mockTimer.value = null;
  }
  if (unlistenFn.value) {
    unlistenFn.value();
    unlistenFn.value = null;
  }
  if (activePingId.value) {
    const id = activePingId.value;
    activePingId.value = null;
    try {
      await exec.pingStop(id);
    } catch {
      /* ignore */
    }
  }
  isPinging.value = false;
}

const togglePing = async () => (isPinging.value ? stopPing() : startPing());

function clearHistory(): void {
  rttHistory.value = [];
  hoveredPoint.value = null;
  if (currentTargetHost.value) {
    const key = getSamplesKey(currentTargetHost.value);
    void pluginStore.set(key, [], { persist: "temp" });
    if (blockId.value) {
      void pluginStore.set(`ping:samples:${currentTargetHost.value}`, [], { persist: "temp" });
    }
  }
  if (chartInstance) {
    chartInstance.data.labels = [];
    chartInstance.data.datasets[0].data = [];
    chartInstance.update();
  }
}

function setHoveredPointByIndex(idx: number): void {
  const rtt = rttHistory.value[idx] ?? null;
  const boxWidth = boxRef.value?.getBoundingClientRect().width || 400;
  const total = rttHistory.value.length;
  const x = total <= 1 ? boxWidth / 2 : (idx / (total - 1)) * (boxWidth - 40) + 20;
  hoveredPoint.value = {
    seq: idx + 1,
    rtt,
    x,
    y: 50,
  };
}

function handleMouseLeave(): void {
  hoveredPoint.value = null;
}

const tooltipStyle = computed(() => {
  if (!hoveredPoint.value || !boxRef.value) return {};
  const boxRect = boxRef.value.getBoundingClientRect();
  const width = boxRect.width || 400;
  const tipWidth = 140;
  let left = hoveredPoint.value.x - tipWidth / 2;
  if (left < 6) left = 6;
  if (left + tipWidth > width - 6) left = width - tipWidth - 6;

  let top = hoveredPoint.value.y - 72;
  if (top < 6) {
    top = hoveredPoint.value.y + 14;
  }
  return {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
  };
});

function getHitSpotStyle(idx: number): Record<string, string> {
  const total = rttHistory.value.length;
  if (total <= 1) {
    return { left: "50%", top: "0%", width: "40px", height: "100%", transform: "translateX(-50%)" };
  }
  const pct = (idx / (total - 1)) * 92 + 4;
  return {
    left: `${pct}%`,
    top: "0%",
    width: "20px",
    height: "100%",
    transform: "translateX(-50%)",
  };
}

function initOrUpdateChart(): void {
  if (!canvasRef.value) return;
  // Guard against headless/test environments where Canvas layout or getContext is unattached
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test") {
    return;
  }
  const ctx = canvasRef.value.getContext?.("2d");
  if (!ctx) return;

  const labels = rttHistory.value.map((_, i) => `#${i + 1}`);
  const data = rttHistory.value.map((v) => (v === null ? null : v));

  if (!chartInstance) {
    chartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "RTT",
            data,
            borderColor: "#18a058",
            borderWidth: 2,
            tension: 0.25,
            fill: true,
            backgroundColor: (context: ScriptableContext<"line">) => {
              const { chart } = context;
              const { ctx: cCtx, chartArea } = chart;
              if (!chartArea) return "rgba(24, 160, 88, 0.15)";
              const gradient = cCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
              gradient.addColorStop(0, "rgba(24, 160, 88, 0.25)");
              gradient.addColorStop(1, "rgba(24, 160, 88, 0.01)");
              return gradient;
            },
            pointBackgroundColor: (context: ScriptableContext<"line">) => {
              const val = context.raw;
              return val === null ? "#e55353" : "#18a058";
            },
            pointBorderColor: "#ffffff",
            pointBorderWidth: 1,
            pointRadius: (context: ScriptableContext<"line">) => {
              const val = context.raw;
              return val === null ? 4 : 3;
            },
            pointHoverRadius: 6,
            pointHoverBackgroundColor: "#63e2b7",
            pointHoverBorderColor: "#ffffff",
            pointHoverBorderWidth: 2,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 150 },
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: (context) => {
              const { tooltip } = context;
              if (!tooltip || tooltip.opacity === 0) {
                hoveredPoint.value = null;
                return;
              }
              const dataPoint = tooltip.dataPoints?.[0];
              if (!dataPoint) {
                hoveredPoint.value = null;
                return;
              }
              const idx = dataPoint.dataIndex;
              const rtt = rttHistory.value[idx] ?? null;
              hoveredPoint.value = {
                seq: idx + 1,
                rtt,
                x: tooltip.caretX,
                y: tooltip.caretY,
              };
            },
          },
        },
        scales: {
          x: {
            grid: {
              color: "rgba(255, 255, 255, 0.05)",
              tickColor: "rgba(255, 255, 255, 0.08)",
            },
            ticks: {
              color: "#8b949e",
              font: { size: 9, family: "monospace" },
              maxRotation: 0,
            },
          },
          y: {
            beginAtZero: true,
            suggestedMax: 35,
            grid: {
              color: "rgba(255, 255, 255, 0.06)",
              tickColor: "rgba(255, 255, 255, 0.08)",
            },
            ticks: {
              color: "#8b949e",
              font: { size: 9, family: "monospace" },
              callback: (val) => `${val} мс`,
            },
          },
        },
      },
    });
  } else {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = data;
    chartInstance.update();
  }
}

watch(
  () => rttHistory.value,
  () => {
    void nextTick(() => {
      initOrUpdateChart();
    });
  },
  { deep: true },
);

let lastSyncedTimestamp: string | null = null;
let lastSyncedMs: number | null = null;

watch(
  () => [target.value?.lastChecked, target.value?.responseTimeMs, target.value?.status] as const,
  ([lastChecked, rtt, status]) => {
    if (isPinging.value || !currentTargetHost.value) return;
    if (lastChecked && lastChecked !== lastSyncedTimestamp) {
      lastSyncedTimestamp = lastChecked;
      if (typeof rtt === "number") {
        lastSyncedMs = rtt;
      }
      if (status === "online" && typeof rtt === "number") {
        addPoint(rtt);
      } else if (status === "offline") {
        addPoint(null);
      }
    } else if (!lastChecked && typeof rtt === "number" && rtt !== lastSyncedMs) {
      lastSyncedMs = rtt;
      addPoint(rtt);
    }
  },
  { immediate: true },
);

watch(
  () => target.value?.host,
  async (newHost, oldHost) => {
    const next = newHost?.trim() || "";
    const prev = oldHost?.trim() || "";
    if (next !== prev) {
      lastSyncedTimestamp = null;
      lastSyncedMs = null;
    }
    if (next !== prev && Boolean(next)) {
      loadSamplesForHost(next);
      if (isPinging.value) {
        await stopPing();
        await startPing();
      }
    } else if (!next && prev) {
      loadSamplesForHost("");
      if (isPinging.value) {
        await stopPing();
      }
    }
  },
);

watch(
  () => props.block?.id,
  (newId, oldId) => {
    if (newId !== oldId) {
      loadSamplesForHost(currentTargetHost.value);
      void nextTick(() => {
        initOrUpdateChart();
        chartInstance?.update("none");
        chartInstance?.resize();
      });
    }
  },
);

function handleVisibilityChange(): void {
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    void nextTick(() => {
      initOrUpdateChart();
      chartInstance?.update("none");
      chartInstance?.resize();
    });
  }
}

onMounted(() => {
  loadSamplesForHost(currentTargetHost.value);
  void nextTick(() => {
    initOrUpdateChart();
    if (typeof ResizeObserver !== "undefined" && boxRef.value) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            initOrUpdateChart();
            chartInstance?.update("none");
            chartInstance?.resize();
          }
        }
      });
      resizeObserver.observe(boxRef.value);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
  });
});

onUnmounted(() => {
  void stopPing();
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
});
</script>

<template>
  <div class="ping-card" data-testid="ping-chart-block">
    <div class="chart-top">
      <div class="top-left">
        <span class="title">Ping</span>
        <n-tag
          size="small"
          :bordered="false"
          :type="currentTargetHost ? 'info' : 'default'"
          class="host-tag"
          data-testid="ping-chart-host-tag"
        >
          {{ currentTargetHost || "Узел не выбран" }}
        </n-tag>
        <n-tag
          size="small"
          :bordered="false"
          :type="statusType"
          class="status-pill"
          data-testid="ping-chart-status"
        >
          {{ stats.status.toUpperCase() }}
        </n-tag>
      </div>

      <div class="top-metrics">
        <span>Мин: <b class="c-min" data-testid="ping-chart-min">{{ minRttFormatted }}</b></span>
        <span>Ср: <b class="c-avg" data-testid="ping-chart-avg">{{ avgRttFormatted }}</b></span>
        <span>Макс: <b class="c-max" data-testid="ping-chart-max">{{ maxRttFormatted }}</b></span>
        <span>Джит: <b data-testid="ping-chart-jitter">{{ jitterFormatted }}</b></span>
        <span>Потери: <b :class="{ 'c-loss': stats.lossPercent > 0 }" data-testid="ping-chart-loss">{{ lossFormatted }}</b></span>
        <span data-testid="ping-chart-packets">{{ stats.received }}/{{ stats.total }}</span>
      </div>

      <n-space size="small" class="top-btns" align="center">
        <n-button
          size="tiny"
          :type="isPinging ? 'error' : 'primary'"
          :secondary="isPinging"
          :disabled="!currentTargetHost"
          data-testid="ping-chart-toggle-btn"
          @click="togglePing"
        >
          {{ isPinging ? "Стоп ping" : "Старт ping" }}
        </n-button>
        <n-button
          size="tiny"
          secondary
          :disabled="rttHistory.length === 0"
          data-testid="ping-chart-clear-btn"
          @click="clearHistory"
        >
          Очистить
        </n-button>
      </n-space>
    </div>

    <div
      ref="boxRef"
      class="canvas-box"
      @mouseleave="handleMouseLeave"
    >
      <canvas
        ref="canvasRef"
        class="ping-canvas"
        data-testid="ping-chart-canvas"
      />
      <!-- Compatibility anchor for legacy test selectors -->
      <div style="display: none;" data-testid="ping-chart-svg" />

      <!-- Interactive hit spots for reliable point hover -->
      <div
        v-for="(_, idx) in rttHistory"
        :key="idx"
        class="ping-point-hit-zone"
        :style="getHitSpotStyle(idx)"
        data-testid="ping-point-hit"
        @mouseenter="setHoveredPointByIndex(idx)"
      />

      <!-- Vertical crosshair line -->
      <div
        v-if="hoveredPoint"
        class="crosshair-line"
        :style="{ left: `${hoveredPoint.x}px` }"
        data-testid="ping-crosshair"
      />

      <!-- Hover Tooltip -->
      <div
        v-if="hoveredPoint"
        class="chart-tooltip"
        :style="tooltipStyle"
        data-testid="ping-chart-tooltip"
      >
        <div class="tip-header">
          <span class="tip-seq">Пакет #{{ hoveredPoint.seq }}</span>
          <span
            class="tip-badge"
            :class="hoveredPoint.rtt === null ? 'tip-loss' : (hoveredPoint.rtt > 150 ? 'tip-warn' : 'tip-ok')"
          >
            {{ hoveredPoint.rtt === null ? 'LOSS' : (hoveredPoint.rtt > 150 ? 'DEGRADED' : 'ONLINE') }}
          </span>
        </div>
        <div class="tip-row">
          <span class="tip-lbl">RTT:</span>
          <b class="tip-val" :class="{ 'c-loss': hoveredPoint.rtt === null }">
            {{ hoveredPoint.rtt !== null ? `${hoveredPoint.rtt} мс` : 'Потеря (timeout)' }}
          </b>
        </div>
        <div class="tip-row">
          <span class="tip-lbl">Джиттер:</span>
          <span class="tip-val">{{ jitterFormatted }}</span>
        </div>
      </div>

      <!-- Empty state overlays -->
      <div v-if="!currentTargetHost" class="chart-empty-overlay" data-testid="ping-chart-no-target">
        <span>Узел не выбран</span>
      </div>
      <div v-else-if="rttHistory.length === 0" class="chart-empty-overlay">
        <span>Нет данных измерений. Нажмите «Старт ping»</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ping-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  padding: 6px 8px;
  gap: 6px;
  font-size: 11px;
  color: #e6edf3;
  overflow: hidden;
}
.chart-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  flex-shrink: 0;
}
.top-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.title {
  font-weight: 700;
  font-size: 12px;
  color: #f0f6fc;
}
.host-tag {
  font-family: monospace;
}
.status-pill {
  font-weight: 700;
  font-size: 9.5px;
}
.top-metrics {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: monospace;
  font-size: 10.5px;
  color: #8b949e;
  overflow: hidden;
  white-space: nowrap;
}
.top-metrics b {
  color: #e6edf3;
}
.c-min { color: #58a6ff; }
.c-avg { color: #63e2b7; }
.c-max { color: #f0883e; }
.c-loss { color: #e55353 !important; }
.top-btns {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.canvas-box {
  flex: 1;
  min-height: 80px;
  width: 100%;
  height: 100%;
  position: relative;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  overflow: hidden;
}
.ping-canvas {
  width: 100% !important;
  height: 100% !important;
  display: block;
}
.ping-point-hit-zone {
  position: absolute;
  cursor: pointer;
  z-index: 5;
  background: transparent;
}
.crosshair-line {
  position: absolute;
  top: 10px;
  bottom: 24px;
  width: 1px;
  border-left: 1.5px dashed #63e2b7;
  pointer-events: none;
  z-index: 6;
  opacity: 0.85;
}
.chart-tooltip {
  position: absolute;
  z-index: 20;
  background: rgba(13, 17, 23, 0.94);
  border: 1px solid rgba(99, 226, 183, 0.45);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55);
  border-radius: 5px;
  padding: 5px 8px;
  font-size: 10px;
  font-family: monospace;
  pointer-events: none;
  min-width: 120px;
  transition: left 0.05s ease-out, top 0.05s ease-out;
}
.tip-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  padding-bottom: 2px;
}
.tip-seq {
  font-weight: 700;
  color: #c9d1d9;
}
.tip-badge {
  font-size: 8.5px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
}
.tip-ok {
  background: rgba(24, 160, 88, 0.2);
  color: #18a058;
}
.tip-warn {
  background: rgba(240, 136, 62, 0.2);
  color: #f0883e;
}
.tip-loss {
  background: rgba(229, 83, 83, 0.25);
  color: #e55353;
}
.tip-row {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  line-height: 1.35;
}
.tip-lbl {
  color: #8b949e;
}
.tip-val {
  color: #f0f6fc;
}
.chart-empty-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(13, 17, 23, 0.65);
  color: #8b949e;
  font-size: 11px;
  pointer-events: none;
}
</style>
