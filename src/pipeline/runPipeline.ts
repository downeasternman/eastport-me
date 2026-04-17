import eastportConfig from "../config/eastport-me";
import { fetchNoaaCoops } from "../ingestion/noaaCoops";
import { fetchNoaaNdbc } from "../ingestion/noaaNdbc";
import { fetchNwsMarine } from "../ingestion/nwsMarine";
import { fetchUsgsGauge } from "../ingestion/usgsGauge";
import { normalizePoints, normalizeWaterLevel } from "../normalization/normalize";
import { evaluateEastport } from "../rules/marineEastport";
import type { AppPayload, NormalizedReading, TideTurningPoint } from "../types";

function latestTs(readings: NormalizedReading[]): string {
  return readings.reduce((best, r) => (r.timestamp_utc > best ? r.timestamp_utc : best), "1970-01-01T00:00:00.000Z");
}

function toChartPoints(readings: NormalizedReading[]): Array<{ ts: string; value: number }> {
  const observed = readings
    .filter((r) => r.metric === "water_level_ft_mllw")
    .map((r) => ({ ts: r.timestamp_utc, value: r.value, priority: 1 }));
  const predicted = readings
    .filter((r) => r.metric === "predicted_tide_ft_mllw")
    .map((r) => ({ ts: r.timestamp_utc, value: r.value, priority: 2 }));
  const merged = [...observed, ...predicted].sort((a, b) => {
    const delta = Date.parse(a.ts) - Date.parse(b.ts);
    if (delta !== 0) return delta;
    return b.priority - a.priority;
  });
  const byTs = new Map<string, { ts: string; value: number }>();
  for (const p of merged) byTs.set(p.ts, { ts: p.ts, value: p.value });
  return Array.from(byTs.values()).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

export async function runPipeline(): Promise<AppPayload> {
  const readings: NormalizedReading[] = [];
  let turningPoints: TideTurningPoint[] = [];
  const settled = await Promise.allSettled([
    fetchNoaaCoops("8410140"),
    fetchNoaaNdbc("PSBM1"),
    fetchNoaaNdbc("44027"),
    fetchUsgsGauge("01029500"),
    fetchNwsMarine("ANZ050")
  ]);

  if (settled[0].status === "fulfilled") {
    readings.push(...normalizeWaterLevel(eastportConfig.id, "8410140", settled[0].value.observed, settled[0].value.predictions));
    turningPoints = settled[0].value.highsLows
      .map((p) => ({ ts: p.ts, value: p.value, kind: p.kind }))
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  } else {
    console.error("NOAA CO-OPS failed", settled[0].reason);
  }
  if (settled[1].status === "fulfilled") {
    readings.push(...normalizePoints(eastportConfig.id, "PSBM1", settled[1].value));
  } else {
    console.error("NOAA NDBC PSBM1 failed", settled[1].reason);
  }
  if (settled[2].status === "fulfilled") {
    readings.push(...normalizePoints(eastportConfig.id, "44027", settled[2].value));
  } else {
    console.error("NOAA NDBC 44027 failed", settled[2].reason);
  }
  if (settled[3].status === "fulfilled") {
    readings.push(...normalizePoints(eastportConfig.id, "01029500", settled[3].value));
  } else {
    console.error("USGS failed", settled[3].reason);
  }
  if (settled[4].status === "fulfilled") {
    readings.push(
      ...normalizePoints(eastportConfig.id, "ANZ050", [
        { ts: settled[4].value.ts, metric: "marine_hazard_flag", value: settled[4].value.hazardFlag, unit: "flag" }
      ])
    );
  } else {
    console.error("NWS marine failed", settled[4].reason);
  }

  if (readings.length === 0) {
    throw new Error("All upstream data sources failed.");
  }

  const chartPoints = toChartPoints(readings);
  const ruleResult = evaluateEastport(readings);
  const generatedAtUtc = new Date().toISOString();

  return {
    location: eastportConfig,
    generatedAtUtc,
    lastUpdatedUtc: latestTs(readings),
    isStale: false,
    readings,
    ruleResult,
    keyChart: {
      metric: "predicted_tide_ft_mllw",
      unit: "ft",
      points: chartPoints,
      turningPoints,
      nowTs: generatedAtUtc
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
