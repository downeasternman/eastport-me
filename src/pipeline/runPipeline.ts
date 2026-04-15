import eastportConfig from "../config/eastport-me";
import { fetchNoaaCoops } from "../ingestion/noaaCoops";
import { fetchNoaaNdbc } from "../ingestion/noaaNdbc";
import { fetchNwsMarine } from "../ingestion/nwsMarine";
import { fetchUsgsGauge } from "../ingestion/usgsGauge";
import { normalizePoints, normalizeWaterLevel } from "../normalization/normalize";
import { evaluateEastport } from "../rules/marineEastport";
import type { AppPayload, NormalizedReading } from "../types";

function latestTs(readings: NormalizedReading[]): string {
  return readings.reduce((best, r) => (r.timestamp_utc > best ? r.timestamp_utc : best), "1970-01-01T00:00:00.000Z");
}

export async function runPipeline(): Promise<AppPayload> {
  const readings: NormalizedReading[] = [];
  const [coops, psbm1, offshore, usgs, nws] = await Promise.all([
    fetchNoaaCoops("8410140"),
    fetchNoaaNdbc("PSBM1"),
    fetchNoaaNdbc("44027"),
    fetchUsgsGauge("01029500"),
    fetchNwsMarine("ANZ050")
  ]);

  readings.push(...normalizeWaterLevel(eastportConfig.id, "8410140", coops.observed, coops.predictions));
  readings.push(...normalizePoints(eastportConfig.id, "PSBM1", psbm1));
  readings.push(...normalizePoints(eastportConfig.id, "44027", offshore));
  readings.push(...normalizePoints(eastportConfig.id, "01029500", usgs));
  readings.push(
    ...normalizePoints(eastportConfig.id, "ANZ050", [
      { ts: nws.ts, metric: "marine_hazard_flag", value: nws.hazardFlag, unit: "flag" }
    ])
  );

  const tideSeries = readings
    .filter((r) => r.metric === "predicted_tide_ft_mllw")
    .sort((a, b) => Date.parse(a.timestamp_utc) - Date.parse(b.timestamp_utc))
    .slice(-24);
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
      points: tideSeries.map((r) => ({ ts: r.timestamp_utc, value: r.value })),
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
