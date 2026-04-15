import "./styles.css";
import Chart from "chart.js/auto";
import locationConfig from "./locationConfig";
import type { AppPayload, NormalizedReading, Status } from "./types";

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
  const res = await fetch("/api/data");
  if (!res.ok) throw new Error(`Failed to load app data (${res.status})`);
  return (await res.json()) as AppPayload;
}

function registerServiceWorker(): void {
  if ("serviceWorker" in navigator) {
    void navigator.serviceWorker.register("/sw.js");
  }
}

function render(payload: AppPayload): void {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) return;
  applySeo(payload);
  const nowIdx = buildNowIndex(payload.keyChart.points, payload.keyChart.nowTs);
  const primary = latestMetric(payload.readings, payload.location.primary_metric);
  const wind = latestMetric(payload.readings, "wind_speed_kts");
  const wave = latestMetric(payload.readings, "wave_height_ft");
  const temp = latestMetric(payload.readings, "water_temp_f");

  root.innerHTML = `
    <main class="app">
      <header class="top">
        <h1>${payload.location.name}</h1>
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
        <canvas id="keyChart" height="180"></canvas>
      </section>
      <section class="support-grid">
        <article class="metric"><h3>Wind</h3><p>${wind ? `${wind.value.toFixed(1)} ${wind.unit}` : "n/a"}</p></article>
        <article class="metric"><h3>Wave Height</h3><p>${wave ? `${wave.value.toFixed(1)} ${wave.unit}` : "n/a"}</p></article>
        <article class="metric"><h3>Water Temp</h3><p>${temp ? `${temp.value.toFixed(1)} ${temp.unit}` : "n/a"}</p></article>
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
  new Chart(canvas, {
    type: "line",
    data: {
      labels: payload.keyChart.points.map((p) => new Date(p.ts).toLocaleTimeString([], { hour: "numeric" })),
      datasets: [
        {
          label: "Predicted Tide (ft)",
          data: payload.keyChart.points.map((p) => p.value),
          borderColor: "#0a63ff",
          pointRadius: payload.keyChart.points.map((_, i) => (i === nowIdx ? 5 : 1.5)),
          pointBackgroundColor: payload.keyChart.points.map((_, i) => (i === nowIdx ? "#d9480f" : "#0a63ff")),
          tension: 0.25
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { title: { display: true, text: "ft" } } }
    }
  });
}

async function boot(): Promise<void> {
  registerServiceWorker();
  const root = document.querySelector<HTMLDivElement>("#app");
  if (root) root.innerHTML = `<main class="app"><p>Loading Eastport conditions...</p></main>`;
  try {
    const payload = await loadPayload();
    render(payload);
  } catch (error) {
    console.error(error);
    if (root) {
      root.innerHTML = `<main class="app"><p>Unable to load Eastport conditions right now.</p></main>`;
    }
  }
}

void boot();
