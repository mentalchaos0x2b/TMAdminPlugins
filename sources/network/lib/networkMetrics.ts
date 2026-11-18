/**
 * Метрики сетевого пинга и вспомогательные функции расчёта статистики.
 */

export interface PingStatistics {
  /** Общее количество отправленных пакетов */
  total: number;
  /** Количество успешно полученных ответов */
  received: number;
  /** Количество потерянных пакетов (таймаутов) */
  lost: number;
  /** Процент потерь от 0 до 100 */
  lossPercent: number;
  /** Минимальное время RTT в мс (null если нет ответов) */
  min: number | null;
  /** Максимальное время RTT в мс (null если нет ответов) */
  max: number | null;
  /** Среднее время RTT в мс (null если нет ответов) */
  avg: number | null;
  /** Джиттер (вариация задержки) в мс (null если < 2 ответов) */
  jitter: number | null;
  /** Вычисленный статус качества канала */
  status: "idle" | "online" | "degraded" | "offline";
}

export interface SvgChartPoint {
  x: number;
  y: number;
  rtt: number | null;
  seq: number;
}

export interface SvgGridLine {
  y: number;
  value: number;
  label: string;
}

export interface SvgChartData {
  points: SvgChartPoint[];
  polylinePoints: string;
  areaPath: string;
  minY: number;
  maxY: number;
  gridLines: SvgGridLine[];
}

/**
 * Рассчитывает полную статистику пинга по массиву значений RTT.
 * null означает потерю пакета / таймаут.
 */
export function calculatePingStats(rttHistory: readonly (number | null)[]): PingStatistics {
  const total = rttHistory.length;
  if (total === 0) {
    return {
      total: 0,
      received: 0,
      lost: 0,
      lossPercent: 0,
      min: null,
      max: null,
      avg: null,
      jitter: null,
      status: "idle",
    };
  }

  const validRtts = rttHistory.filter(
    (v): v is number => typeof v === "number" && !Number.isNaN(v) && v >= 0,
  );
  const received = validRtts.length;
  const lost = total - received;
  const lossPercent = Math.round((lost / total) * 100);

  if (received === 0) {
    return {
      total,
      received: 0,
      lost,
      lossPercent: 100,
      min: null,
      max: null,
      avg: null,
      jitter: null,
      status: "offline",
    };
  }

  const min = Math.min(...validRtts);
  const max = Math.max(...validRtts);
  const sum = validRtts.reduce((acc, val) => acc + val, 0);
  const avg = Math.round(sum / received);

  // Расчёт джиттера как среднего абсолютного изменения последовательных RTT
  let jitter: number | null = null;
  if (received >= 2) {
    let diffSum = 0;
    for (let i = 1; i < validRtts.length; i++) {
      diffSum += Math.abs(validRtts[i]! - validRtts[i - 1]!);
    }
    jitter = Math.round((diffSum / (validRtts.length - 1)) * 10) / 10;
  }

  // Оценка состояния канала
  let status: PingStatistics["status"] = "online";
  if (lossPercent >= 50) {
    status = "degraded";
  } else if (lossPercent > 5 || avg > 150) {
    status = "degraded";
  }

  return {
    total,
    received,
    lost,
    lossPercent,
    min,
    max,
    avg,
    jitter,
    status,
  };
}

/**
 * Добавляет новую точку RTT в массив истории, ограничивая размер до maxPoints (по умолчанию 60).
 */
export function appendRttPoint(
  history: readonly (number | null)[],
  rtt: number | null,
  maxPoints = 60,
): (number | null)[] {
  const next = [...history, rtt];
  if (next.length > maxPoints) {
    return next.slice(next.length - maxPoints);
  }
  return next;
}

/**
 * Форматирует значение задержки RTT в читаемый вид.
 */
export function formatRtt(ms: number | null | undefined, timeoutLabel = "–"): string {
  if (ms === null) return timeoutLabel;
  if (ms === undefined) return "–";
  return `${Math.round(ms)} мс`;
}

/**
 * Форматирует процент потерь.
 */
export function formatLoss(lossPercent: number | null | undefined): string {
  if (lossPercent === null || lossPercent === undefined) return "0%";
  return `${lossPercent}%`;
}

/**
 * Форматирует джиттер.
 */
export function formatJitter(jitter: number | null | undefined): string {
  if (jitter === null || jitter === undefined) return "–";
  return `${jitter} мс`;
}

/**
 * Форматирует временную метку.
 */
export function formatTimestamp(timestamp?: string | number | Date): string {
  if (!timestamp) return "–";
  try {
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return "–";
    return d.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "–";
  }
}

export interface ChartPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Рассчитывает координаты и пути для SVG рендера графика RTT.
 */
export function computeSvgChartData(
  rttHistory: readonly (number | null)[],
  width = 600,
  height = 200,
  padding: ChartPadding = { top: 16, right: 16, bottom: 24, left: 36 },
): SvgChartData {
  const contentWidth = Math.max(1, width - padding.left - padding.right);
  const contentHeight = Math.max(1, height - padding.top - padding.bottom);

  if (rttHistory.length === 0) {
    return {
      points: [],
      polylinePoints: "",
      areaPath: "",
      minY: 0,
      maxY: 100,
      gridLines: [
        { y: padding.top, value: 100, label: "100 мс" },
        { y: padding.top + contentHeight / 2, value: 50, label: "50 мс" },
        { y: padding.top + contentHeight, value: 0, label: "0 мс" },
      ],
    };
  }

  const validRtts = rttHistory.filter(
    (v): v is number => typeof v === "number" && !Number.isNaN(v) && v >= 0,
  );

  const rawMax = validRtts.length > 0 ? Math.max(...validRtts) : 50;
  // Верхняя граница с запасом (кратна 10 или 20, минимум 30 мс)
  const maxY = Math.max(30, Math.ceil((rawMax * 1.25) / 10) * 10);
  const minY = 0;

  const count = rttHistory.length;
  const stepX = count > 1 ? contentWidth / (count - 1) : 0;

  const points: SvgChartPoint[] = [];
  const polylineCoords: string[] = [];

  for (let i = 0; i < count; i++) {
    const rtt = rttHistory[i] ?? null;
    const x = padding.left + i * stepX;

    let y: number;
    if (rtt === null) {
      // Таймаут отображаем на верхней границе (или чуть ниже)
      y = padding.top;
    } else {
      const normalized = Math.min(1, Math.max(0, (rtt - minY) / (maxY - minY)));
      // y=0 вверху SVG, поэтому инвертируем
      y = padding.top + (1 - normalized) * contentHeight;
      polylineCoords.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }

    points.push({
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
      rtt,
      seq: i + 1,
    });
  }

  const polylinePoints = polylineCoords.join(" ");

  // Формируем контур заливки площади под линией
  let areaPath = "";
  if (polylineCoords.length > 0) {
    const baselineY = padding.top + contentHeight;
    const firstCoord = polylineCoords[0]!.split(",");
    const lastCoord = polylineCoords[polylineCoords.length - 1]!.split(",");
    const firstX = firstCoord[0];
    const lastX = lastCoord[0];

    areaPath = `M ${firstX} ${baselineY} L ${polylinePoints.replace(/ /g, " L ")} L ${lastX} ${baselineY} Z`;
  }

  // Горизонтальные линии сетки
  const gridLines: SvgGridLine[] = [
    {
      y: padding.top,
      value: maxY,
      label: `${maxY} мс`,
    },
    {
      y: padding.top + contentHeight / 2,
      value: Math.round(maxY / 2),
      label: `${Math.round(maxY / 2)} мс`,
    },
    {
      y: padding.top + contentHeight,
      value: 0,
      label: "0 мс",
    },
  ];

  return {
    points,
    polylinePoints,
    areaPath,
    minY,
    maxY,
    gridLines,
  };
}
