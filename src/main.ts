import "./styles.css";
import Chart from "chart.js/auto";
import "chartjs-adapter-date-fns";
import locationConfig from "./locationConfig";
import { runPipeline } from "./pipeline/runPipeline";
import type { AppPayload, NormalizedReading, Status, TideTurningPoint } from "./types";

const statusLabel: Record<Status, string> = {
  good: "GOOD",
  fair: "FAIR",
  caution: "CAUTION",
  poor: "POOR"
};

function minutesAgo(ts: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 60000));
}

function latestMetric(readings: NormalizedReading[], metric: string): { value: number; unit: string } | null {
  const row = readings
    .filter((r) => r.metric === metric)
    .sort((a, b) => Date.parse(b.timestamp_utc) - Date.parse(a.timestamp_utc))[0];
  if (!row) return null;
  return { value: row.value, unit: row.unit };
}

/** Prefer wind direction from the same buoy/station as the latest wind speed. */
function latestWindSpeedAndDirection(
  readings: NormalizedReading[]
): { speed: { value: number; unit: string }; direction: { value: number; unit: string } | null } | null {
  const speedRows = readings
    .filter((r) => r.metric === "wind_speed_kts")
    .sort((a, b) => Date.parse(b.timestamp_utc) - Date.parse(a.timestamp_utc));
  const latestSpeed = speedRows[0];
  if (!latestSpeed) return null;
  const dirRows = readings
    .filter((r) => r.metric === "wind_direction_deg" && r.source_station_id === latestSpeed.source_station_id)
    .sort((a, b) => Date.parse(b.timestamp_utc) - Date.parse(a.timestamp_utc));
  const latestDir = dirRows[0];
  return {
    speed: { value: latestSpeed.value, unit: latestSpeed.unit },
    direction: latestDir ? { value: latestDir.value, unit: latestDir.unit } : null
  };
}

function cardinalDirection(degrees: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const normalized = ((degrees % 360) + 360) % 360;
  const idx = Math.round(normalized / 45) % 8;
  return dirs[idx];
}

function metricSeriesFromBestSource(
  readings: NormalizedReading[],
  metric: string
): Array<{ ts: string; value: number }> {
  const rows = readings.filter((r) => r.metric === metric);
  if (!rows.length) return [];
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.source_station_id, (counts.get(row.source_station_id) || 0) + 1);
  const bestSource = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
  return rows
    .filter((r) => r.source_station_id === bestSource)
    .sort((a, b) => Date.parse(a.timestamp_utc) - Date.parse(b.timestamp_utc))
    .map((r) => ({ ts: r.timestamp_utc, value: r.value }));
}

/** Compare earlier half vs later half of the series (sorted by time). */
function metricTrend(
  series: Array<{ ts: string; value: number }>,
  epsAbs: number
): "rising" | "falling" | "flat" | null {
  if (series.length < 2) return null;
  const sorted = [...series].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const n = sorted.length;
  const half = Math.max(1, Math.floor(n / 2));
  const older = sorted.slice(0, half);
  const newer = sorted.slice(half);
  const o = older.reduce((s, p) => s + p.value, 0) / older.length;
  const w = newer.reduce((s, p) => s + p.value, 0) / newer.length;
  const d = w - o;
  if (!Number.isFinite(d)) return null;
  if (Math.abs(d) < epsAbs) return "flat";
  return d > 0 ? "rising" : "falling";
}

function trendWord(t: "rising" | "falling" | "flat" | null): string {
  if (t == null) return "";
  if (t === "rising") return "Rising";
  if (t === "falling") return "Falling";
  return "Flat";
}

function buildNowIndex(points: Array<{ ts: string }>, nowTs: string): number {
  if (!points.length) return -1;
  let idx = 0;
  let best = Number.POSITIVE_INFINITY;
  const nowMs = Date.parse(nowTs);
  points.forEach((p, i) => {
    const diff = Math.abs(Date.parse(p.ts) - nowMs);
    if (diff < best) {
      best = diff;
      idx = i;
    }
  });
  return idx;
}

type TidePoint = { ts: string; value: number };
function findTideExtrema(points: TidePoint[]): Array<{ index: number; kind: "peak" | "trough" }> {
  const extrema: Array<{ index: number; kind: "peak" | "trough" }> = [];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1].value;
    const cur = points[i].value;
    const next = points[i + 1].value;
    if (cur >= prev && cur >= next && (cur > prev || cur > next)) {
      extrema.push({ index: i, kind: "peak" });
      continue;
    }
    if (cur <= prev && cur <= next && (cur < prev || cur < next)) {
      extrema.push({ index: i, kind: "trough" });
    }
  }
  return extrema;
}

function inferredTurningPoints(points: TidePoint[]): TideTurningPoint[] {
  return findTideExtrema(points).map((e) => ({ ...points[e.index], kind: e.kind }));
}

const TIDE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Chart starts at the most recent high/low before "now" (not mid-cycle).
 * Series points rarely share the exact NOAA hilo timestamp, so we slice from the first
 * sample at/after that instant and prepend the official turning point when needed.
 * Span is 24h from that turning point (title: "24h Tide Trend").
 */
function buildTideTrendWindow(points: TidePoint[], turningPoints: TideTurningPoint[], nowTs: string): TidePoint[] {
  if (points.length < 2) return points;
  const nowMs = Date.parse(nowTs);
  const priorTurningPoint = turningPoints
    .filter((p) => Date.parse(p.ts) <= nowMs)
    .reduce<TideTurningPoint | null>((best, p) => {
      if (!best) return p;
      return Date.parse(p.ts) > Date.parse(best.ts) ? p : best;
    }, null);
  if (!priorTurningPoint) return points;
  const priorMs = Date.parse(priorTurningPoint.ts);
  const startIdx = points.findIndex((p) => Date.parse(p.ts) >= priorMs);
  if (startIdx < 0) return points;
  let windowPts = points.slice(startIdx);
  const firstMs = windowPts.length ? Date.parse(windowPts[0].ts) : 0;
  if (firstMs > priorMs) {
    windowPts = [{ ts: priorTurningPoint.ts, value: priorTurningPoint.value }, ...windowPts];
  }
  const endMs = priorMs + TIDE_WINDOW_MS;
  windowPts = windowPts.filter((p) => Date.parse(p.ts) <= endMs);
  return windowPts.length ? windowPts : points;
}

function formatTideClock(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function nextExtremaFromNow(
  turningPoints: TideTurningPoint[],
  nowTs: string
): { point: TidePoint; kind: "peak" | "trough"; hoursAway: number } | null {
  const nowMs = Date.parse(nowTs);
  const point = turningPoints.find((p) => Date.parse(p.ts) >= nowMs);
  if (!point) return null;
  const hoursAway = Math.max(0, (Date.parse(point.ts) - nowMs) / 3_600_000);
  return { point, kind: point.kind, hoursAway };
}

const tideExtremaPlugin = {
  id: "tideExtremaPlugin",
  afterDatasetsDraw(chart: Chart) {
    const extremaDatasetIdx = chart.data.datasets.findIndex((d) => d.label === "Extrema markers");
    if (extremaDatasetIdx < 0) return;
    const meta = chart.getDatasetMeta(extremaDatasetIdx);
    const dataset = chart.data.datasets[extremaDatasetIdx];
    const points = Array.isArray(dataset.data) ? dataset.data : [];
    if (meta.hidden || points.length === 0) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = "600 11px system-ui";
    ctx.textAlign = "center";
    points.forEach((point, i) => {
      if (typeof point !== "object" || point === null || !("y" in point)) return;
      const marker = meta.data[i];
      if (!marker) return;
      const rawY = Number((point as { y: number }).y);
      if (!Number.isFinite(rawY)) return;
      const yPixel = marker.y + (i % 2 === 0 ? -12 : 16);
      const raw = (dataset as unknown as { extremaKinds?: string[] }).extremaKinds?.[i];
      const ts = (dataset as unknown as { extremaTimes?: string[] }).extremaTimes?.[i];
      const label = raw === "peak" ? "High" : raw === "trough" ? "Low" : "";
      if (!label) return;
      ctx.fillStyle = "rgb(51, 65, 85)";
      const timePart = ts ? ` @ ${formatTideClock(ts)}` : "";
      if (marker.x < chart.chartArea.left + 70) ctx.textAlign = "left";
      else if (marker.x > chart.chartArea.right - 70) ctx.textAlign = "right";
      else ctx.textAlign = "center";
      ctx.fillText(`${label} ${rawY.toFixed(2)} ft${timePart}`, marker.x, yPixel);
    });
    ctx.restore();
  }
};

Chart.register(tideExtremaPlugin);

function makePlaceholderChart(nowIso: string): Array<{ ts: string; value: number }> {
  const nowMs = Date.parse(nowIso);
  return Array.from({ length: 24 }, (_, i) => {
    const ts = new Date(nowMs - (23 - i) * 60 * 60 * 1000).toISOString();
    const value = 5 + Math.sin(i / 3) * 1.3;
    return { ts, value: Number(value.toFixed(2)) };
  });
}

function buildFallbackPayload(reason: string): AppPayload {
  const nowIso = new Date().toISOString();
  const placeholder = makePlaceholderChart(nowIso);
  return {
    location: locationConfig,
    generatedAtUtc: nowIso,
    lastUpdatedUtc: nowIso,
    isStale: true,
    staleReason: reason,
    readings: [
      {
        location_id: locationConfig.id,
        metric: "water_level_ft_mllw",
        value: placeholder[placeholder.length - 1].value,
        unit: "ft",
        timestamp_utc: nowIso,
        source_station_id: "fallback"
      }
    ],
    ruleResult: {
      status: "caution",
      summary: "Live Eastport feeds are temporarily unavailable. Showing fallback chart layout.",
      details: ["Live data feed issue"],
      interpretations: [
        {
          userType: "boaters",
          message: "Confirm tides, winds, and hazards from official sources before departing."
        },
        {
          userType: "fishermen",
          message: "Use local judgment and verify latest conditions before planning your trip."
        },
        {
          userType: "tour_operators",
          message: "Check marine advisories directly before scheduling open-water runs."
        }
      ]
    },
    keyChart: {
      metric: "predicted_tide_ft_mllw",
      unit: "ft",
      points: placeholder,
      nowTs: nowIso
    },
    sources: [
      { name: "NOAA CO-OPS 8410140", url: "https://tidesandcurrents.noaa.gov/stationhome.html?id=8410140" },
      { name: "NOAA NDBC PSBM1", url: "https://www.ndbc.noaa.gov/station_page.php?station=psbm1" },
      { name: "NOAA NDBC 44027", url: "https://www.ndbc.noaa.gov/station_page.php?station=44027" },
      { name: "USGS 01029500", url: "https://waterdata.usgs.gov/monitoring-location/01029500/" },
      { name: "NWS Marine ANZ050", url: "https://forecast.weather.gov/shmrn.php?mz=anz050&syn=anz005" }
    ]
  };
}

function applySeo(payload: AppPayload): void {
  document.title = payload.location.seo.title;
  const meta = document.querySelector('meta[name="description"]') ?? document.createElement("meta");
  meta.setAttribute("name", "description");
  meta.setAttribute("content", payload.location.seo.description);
  document.head.appendChild(meta);

  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${payload.location.name} conditions today`,
    description: payload.location.seo.description,
    keywords: payload.location.seo.activity_keywords.join(", "),
    spatialCoverage: {
      "@type": "Place",
      geo: {
        "@type": "GeoCoordinates",
        latitude: payload.location.coordinates.lat,
        longitude: payload.location.coordinates.lng
      }
    }
  });
  document.head.appendChild(script);
}

async function loadPayload(): Promise<AppPayload> {
  try {
    const res = await fetch("/api/data");
    if (!res.ok) throw new Error(`Failed to load app data (${res.status})`);
    const payload = (await res.json()) as AppPayload;
    // #region agent log
    fetch("http://127.0.0.1:7880/ingest/15016d89-948c-4052-8cdb-ef26db9d1a03",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"f3ef61"},body:JSON.stringify({sessionId:"f3ef61",runId:"initial",hypothesisId:"H1",location:"src/main.ts:136",message:"loadPayload received /api/data response",data:{status:res.status,hasLocation:!!payload?.location,hasSeo:!!payload?.location?.seo,topLevelKeys:payload&&typeof payload==="object"?Object.keys(payload).slice(0,10):[]},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return payload;
  } catch (error) {
    // #region agent log
    fetch("http://127.0.0.1:7880/ingest/15016d89-948c-4052-8cdb-ef26db9d1a03",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"f3ef61"},body:JSON.stringify({sessionId:"f3ef61",runId:"initial",hypothesisId:"H4",location:"src/main.ts:141",message:"loadPayload fell back to browser pipeline",data:{isDev:import.meta.env.DEV,errorMessage:error instanceof Error?error.message:String(error)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    // Local Vite dev does not serve Vercel API routes.
    if (!import.meta.env.DEV) throw error;
    const payload = await runPipeline();
    return {
      ...payload,
      isStale: true,
      staleReason: "Local fallback mode: generated in browser because /api/data is unavailable."
    };
  }
}

function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  if (import.meta.env.PROD) {
    void navigator.serviceWorker.register("/sw.js");
    return;
  }
  // Prevent stale cached error responses during local debugging.
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => void registration.unregister());
  });
}

function render(payload: AppPayload): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) return;
  // #region agent log
  fetch("http://127.0.0.1:7880/ingest/15016d89-948c-4052-8cdb-ef26db9d1a03",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"f3ef61"},body:JSON.stringify({sessionId:"f3ef61",runId:"initial",hypothesisId:"H3",location:"src/main.ts:171",message:"render invoked",data:{hasLocation:!!payload?.location,hasSeo:!!payload?.location?.seo,hasRuleResult:!!payload?.ruleResult,isStale:!!payload?.isStale},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  applySeo(payload);
  const allTurningPoints = payload.keyChart.turningPoints?.length
    ? payload.keyChart.turningPoints
    : inferredTurningPoints(payload.keyChart.points);
  const trendPoints = buildTideTrendWindow(payload.keyChart.points, allTurningPoints, payload.keyChart.nowTs);
  const nowIdx = buildNowIndex(trendPoints, payload.keyChart.nowTs);
  const windowStartMs = trendPoints.length ? Date.parse(trendPoints[0].ts) : 0;
  const windowEndMs = trendPoints.length ? Date.parse(trendPoints[trendPoints.length - 1].ts) : 0;
  const extrema = allTurningPoints.filter((p) => {
    const t = Date.parse(p.ts);
    return t >= windowStartMs && t <= windowEndMs;
  });
  const nextTurn = nextExtremaFromNow(allTurningPoints, payload.keyChart.nowTs);
  const primary = latestMetric(payload.readings, payload.location.primary_metric);
  const windInfo = latestWindSpeedAndDirection(payload.readings);
  const wave = latestMetric(payload.readings, "wave_height_ft");
  const temp = latestMetric(payload.readings, "water_temp_f");
  const pressureSeries = metricSeriesFromBestSource(payload.readings, "barometric_pressure_hpa");
  const waveSeries = metricSeriesFromBestSource(payload.readings, "wave_height_ft");
  const tempSeries = metricSeriesFromBestSource(payload.readings, "water_temp_f");
  const windSpeedSeries = metricSeriesFromBestSource(payload.readings, "wind_speed_kts");
  const pressureLatest = pressureSeries.length ? pressureSeries[pressureSeries.length - 1] : null;
  const pressureTrend = metricTrend(pressureSeries, 0.5);
  const waveTrend = metricTrend(waveSeries, 0.12);
  const tempTrend = metricTrend(tempSeries, 0.5);
  const windTrend = metricTrend(windSpeedSeries, 0.75);

  root.innerHTML = `
    <main class="app">
      <header class="app-header">
        <h1>${payload.location.name}</h1>
        <p class="tagline">NOAA tides, marine weather, waves, and USGS context</p>
        <p class="updated">Last updated ${minutesAgo(payload.lastUpdatedUtc)} minutes ago (${new Date(payload.lastUpdatedUtc).toLocaleTimeString()})</p>
      </header>
      <section class="status status-${payload.ruleResult.status}">
        <div class="status-row"><span class="status-icon" aria-hidden="true">${payload.ruleResult.status === "good" ? "✓" : "!"}</span><strong>${statusLabel[payload.ruleResult.status]}</strong></div>
        <p>${payload.ruleResult.summary}</p>
        ${payload.isStale ? `<p class="stale">${payload.staleReason || "Using last known data."}</p>` : ""}
      </section>
      <section class="primary">
        <h2>Primary Metric</h2>
        <p class="primary-value">${primary ? `${primary.value.toFixed(2)} ${primary.unit}` : "Unavailable"}</p>
        <p class="primary-label">Current water level (MLLW)</p>
      </section>
      <section class="card">
        <h2>24h Tide Trend</h2>
        <p class="chart-subtitle">From the most recent high or low tide through the next 24 hours.</p>
        <canvas id="keyChart" height="180"></canvas>
        <p id="tideEta" class="chart-note"></p>
      </section>
      <section class="support-grid support-grid-metrics">
        <article class="metric"><h3>Wind</h3><p>${windInfo ? `${windInfo.speed.value.toFixed(1)} ${windInfo.speed.unit}${windInfo.direction ? ` · ${cardinalDirection(windInfo.direction.value)} (${Math.round(windInfo.direction.value)}°)` : ""}${windTrend != null ? ` · ${trendWord(windTrend)}` : ""}` : "n/a"}</p></article>
        <article class="metric"><h3>Wave Height</h3><p>${wave ? `${wave.value.toFixed(1)} ${wave.unit}${waveTrend != null ? ` · ${trendWord(waveTrend)}` : ""}` : "n/a"}</p></article>
        <article class="metric"><h3>Water Temp</h3><p>${temp ? `${temp.value.toFixed(1)} ${temp.unit}${tempTrend != null ? ` · ${trendWord(tempTrend)}` : ""}` : "n/a"}</p></article>
        <article class="metric"><h3>Barometric Pressure</h3><p>${pressureLatest ? `${pressureLatest.value.toFixed(1)} hPa${pressureTrend != null ? ` · ${trendWord(pressureTrend)}` : ""}` : "n/a"}</p></article>
      </section>
      <section class="card">
        <h2>What this means</h2>
        ${payload.ruleResult.interpretations.map((i) => `<p><strong>${i.userType.replace("_", " ")}</strong>: ${i.message}</p>`).join("")}
      </section>
      <details class="card">
        <summary>Data sources and methodology</summary>
        <ul>${payload.sources.map((s) => `<li><a href="${s.url}" target="_blank" rel="noreferrer">${s.name}</a></li>`).join("")}</ul>
      </details>
      <section class="card">
        <p>This app is free. If it saved you a bad trip, buy me a coffee.</p>
        <a class="cta" href="${payload.location.tip_url}" target="_blank" rel="noreferrer">Support this app</a>
      </section>
      <footer class="footer">
        <a href="${payload.location.contact_url}" target="_blank" rel="noreferrer">Need a custom data app for your marina, outfitter, or municipality? Let’s talk.</a>
      </footer>
    </main>
  `;

  const canvas = document.getElementById("keyChart") as HTMLCanvasElement | null;
  if (!canvas) return;
  const tideEta = document.getElementById("tideEta");
  if (tideEta) {
    if (nextTurn) {
      const kindLabel = nextTurn.kind === "peak" ? "high" : "low";
      const hoursText =
        nextTurn.hoursAway < 1
          ? `${Math.max(1, Math.round(nextTurn.hoursAway * 60))} min`
          : `${nextTurn.hoursAway.toFixed(1)} hours`;
      tideEta.textContent = `${hoursText} to ${kindLabel} tide (${formatTideClock(nextTurn.point.ts)}).`;
    } else {
      tideEta.textContent = "Next high/low tide time unavailable in current data window.";
    }
  }
  const tideSeries = trendPoints.map((p) => ({ x: Date.parse(p.ts), y: p.value }));
  const extremaSeries = extrema.map((e) => ({
    x: Date.parse(e.ts),
    y: e.value,
    kind: e.kind,
    ts: e.ts
  }));
  let yMin = 0;
  let yMax = 1;
  if (trendPoints.length) {
    const tideVals = trendPoints.map((p) => p.value);
    yMin = Math.min(...tideVals);
    yMax = Math.max(...tideVals);
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
      yMin = 0;
      yMax = 1;
    }
    if (yMin === yMax) {
      yMin -= 0.5;
      yMax += 0.5;
    }
  }
  const yPad = Math.max((yMax - yMin) * 0.12, 0.35);
  new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Predicted Tide (ft)",
          data: tideSeries,
          borderColor: "#0a63ff",
          pointRadius: trendPoints.map((_, i) => (i === nowIdx ? 5 : 0)),
          pointHoverRadius: 4,
          pointBackgroundColor: trendPoints.map((_, i) => (i === nowIdx ? "#d9480f" : "#0a63ff")),
          tension: 0.25,
          parsing: false
        },
        {
          type: "scatter",
          label: "Extrema markers",
          data: extremaSeries,
          pointRadius: 4,
          pointHoverRadius: 5,
          pointBackgroundColor: extremaSeries.map((p) => (p.kind === "peak" ? "#0f766e" : "#9333ea")),
          pointStyle: extremaSeries.map((p) => (p.kind === "peak" ? "triangle" : "rectRot")),
          showLine: false,
          parsing: false,
          // Used by a local plugin for "High"/"Low" labels near markers.
          extremaKinds: extremaSeries.map((p) => p.kind),
          extremaTimes: extremaSeries.map((p) => p.ts)
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 2.6,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = items[0]?.parsed.x;
              if (typeof x !== "number") return "";
              return new Date(x).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
              });
            },
            label: (ctx) => {
              if (ctx.parsed.y == null) return "";
              if (ctx.dataset.label === "Extrema markers") {
                const raw = ctx.raw as { kind?: string; ts?: string } | undefined;
                const kind = raw?.kind === "peak" ? "High tide" : "Low tide";
                const timePart = raw?.ts ? ` @ ${formatTideClock(raw.ts)}` : "";
                return `${kind}: ${ctx.parsed.y.toFixed(2)} ft (MLLW)${timePart}`;
              }
              return `Tide: ${ctx.parsed.y.toFixed(2)} ft (MLLW)`;
            }
          }
        }
      },
      scales: {
        y: {
          min: yMin - yPad,
          max: yMax + yPad,
          title: { display: true, text: "ft (MLLW)" },
          ticks: { maxTicksLimit: 6 }
        },
        x: {
          type: "time",
          time: {
            tooltipFormat: "MMM d, h:mm a",
            unit: "hour",
            displayFormats: { hour: "h:mm a" }
          },
          ticks: { maxTicksLimit: 8 }
        }
      }
    }
  });
}

async function boot(): Promise<void> {
  registerServiceWorker();
  const root = document.querySelector<HTMLDivElement>("#app");
  if (root) root.innerHTML = `<main class="app"><p>Loading Eastport conditions...</p></main>`;
  let payload: AppPayload;
  try {
    payload = await loadPayload();
  } catch (error) {
    console.error(error);
    const msg = error instanceof Error ? error.message : "Unknown fetch error";
    payload = buildFallbackPayload(`Unable to load live Eastport conditions right now (${msg}).`);
  }
  render(payload);
}

void boot();
