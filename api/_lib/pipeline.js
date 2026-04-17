const TTL_MS = 10 * 60 * 1000;
const CACHE_KEY = "eastport-me:payload";

function getMemory() {
  if (!globalThis.__eastportCache) globalThis.__eastportCache = { value: null, expiresAt: 0, lastGood: null };
  return globalThis.__eastportCache;
}

async function fetchTextWithRetry(url, retries = 2) {
  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (error) {
      if (attempt >= retries) throw error;
      attempt += 1;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function fetchJsonWithRetry(url, retries = 2) {
  return JSON.parse(await fetchTextWithRetry(url, retries));
}

function normalize(locationId, sourceStationId, metric, unit, points) {
  return points.map((p) => ({
    location_id: locationId,
    metric,
    value: p.value,
    unit,
    timestamp_utc: p.ts,
    source_station_id: sourceStationId
  }));
}

function toChartPoints(readings) {
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
  const byTs = new Map();
  for (const p of merged) byTs.set(p.ts, { ts: p.ts, value: p.value });
  return Array.from(byTs.values()).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

function parseNdbcRows(text) {
  const lines = text.split(/\r?\n/).filter((x) => x.trim());
  const header = lines.find((line) => line.includes("YY") && line.includes("MM") && line.includes("DD"));
  if (!header) return [];
  const idx = lines.indexOf(header);
  const keys = header.replace(/^#\s*/, "").trim().split(/\s+/);
  return lines
    .slice(idx + 1)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= keys.length)
    .map((cols) => Object.fromEntries(keys.map((k, i) => [k, cols[i]])));
}

function ndbcTs(row) {
  const yy = Number(row.YY);
  const mm = Number(row.MM);
  const dd = Number(row.DD);
  const hh = Number(row.hh);
  const min = Number(row.mm);
  if (![yy, mm, dd, hh, min].every(Number.isFinite)) return null;
  return new Date(Date.UTC(yy, mm - 1, dd, hh, min)).toISOString();
}

function evaluateStatus(readings) {
  const latest = (metric) =>
    readings
      .filter((r) => r.metric === metric)
      .sort((a, b) => Date.parse(b.timestamp_utc) - Date.parse(a.timestamp_utc))[0]?.value ?? null;
  const wind = latest("wind_speed_kts") ?? 0;
  const gust = latest("wind_gust_kts") ?? 0;
  const wave = latest("wave_height_ft") ?? 0;
  const hazard = latest("marine_hazard_flag") ?? 0;
  let score = 0;
  if (wind > 18) score += 1;
  if (gust > 25) score += 1;
  if (wave > 4) score += 1;
  if (hazard > 0) score += 2;
  const status = score >= 4 ? "poor" : score >= 3 ? "caution" : score >= 1 ? "fair" : "good";
  const summary = {
    good: "Good conditions for most small-boat and charter activity.",
    fair: "Fair conditions: check timing and route before departure.",
    caution: "Use caution today: rougher marine conditions are likely.",
    poor: "Poor boating conditions right now. Delay or choose protected water."
  }[status];
  return { status, summary };
}

export async function buildPayload() {
  const config = {
    id: "eastport-me",
    name: "Eastport, ME",
    coordinates: { lat: 44.906, lng: -66.989 },
    user_types: ["boaters", "fishermen", "tour_operators"],
    primary_metric: "water_level_ft_mllw",
    rules: "marine_eastport",
    tip_url: "https://ko-fi.com/",
    contact_url: "https://github.com/downeasternman/eastport-me/issues",
    seo: {
      title: "Eastport ME Conditions Today | Boating, Fishing, Marine Forecast",
      description:
        "Eastport, Maine conditions today for boaters, fishermen, and tour operators. Live tides, winds, waves, water level, and marine hazard outlook.",
      activity_keywords: ["boating Eastport ME", "fishing Eastport ME", "Eastport conditions today"]
    }
  };
  const now = new Date();
  const begin = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const fmt = (d) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")} ${String(
      d.getUTCHours()
    ).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

  const obsUrl =
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&application=waterapps&format=json` +
    `&time_zone=gmt&units=english&interval=6&datum=MLLW&station=8410140&begin_date=${encodeURIComponent(fmt(begin))}` +
    `&end_date=${encodeURIComponent(fmt(now))}`;
  const predUrl =
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=waterapps&format=json` +
    `&time_zone=gmt&units=english&interval=h&datum=MLLW&station=8410140&begin_date=${encodeURIComponent(fmt(now))}` +
    `&end_date=${encodeURIComponent(fmt(end))}`;
  const hiloUrl =
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=waterapps&format=json` +
    `&time_zone=gmt&units=english&interval=hilo&datum=MLLW&station=8410140&begin_date=${encodeURIComponent(fmt(begin))}` +
    `&end_date=${encodeURIComponent(fmt(end))}`;

  const [obs, pred, hilo, psbmTxt, buoyTxt, usgs, nwsTxt] = await Promise.all([
    fetchJsonWithRetry(obsUrl),
    fetchJsonWithRetry(predUrl),
    fetchJsonWithRetry(hiloUrl),
    fetchTextWithRetry("https://www.ndbc.noaa.gov/data/realtime2/PSBM1.txt"),
    fetchTextWithRetry("https://www.ndbc.noaa.gov/data/realtime2/44027.txt"),
    fetchJsonWithRetry("https://waterservices.usgs.gov/nwis/iv/?format=json&sites=01029500&parameterCd=00060,00065"),
    fetchTextWithRetry("https://forecast.weather.gov/shmrn.php?mz=anz050&syn=anz005")
  ]);

  const readings = [];
  readings.push(
    ...normalize(
      "eastport-me",
      "8410140",
      "water_level_ft_mllw",
      "ft",
      (obs.data || []).map((d) => ({ ts: new Date(`${d.t}Z`).toISOString(), value: Number(d.v) })).filter((d) => Number.isFinite(d.value))
    )
  );
  readings.push(
    ...normalize(
      "eastport-me",
      "8410140",
      "predicted_tide_ft_mllw",
      "ft",
      (pred.predictions || [])
        .map((d) => ({ ts: new Date(`${d.t}Z`).toISOString(), value: Number(d.v) }))
        .filter((d) => Number.isFinite(d.value))
    )
  );

  for (const [station, txt] of [
    ["PSBM1", psbmTxt],
    ["44027", buoyTxt]
  ]) {
    for (const row of parseNdbcRows(txt)) {
      const ts = ndbcTs(row);
      if (!ts) continue;
      const wdir = Number(row.WDIR);
      const pres = Number(row.PRES);
      const pairs = [
        ["wind_direction_deg", wdir, "deg"],
        ["wind_speed_kts", Number(row.WSPD), "kts"],
        ["wind_gust_kts", Number(row.GST), "kts"],
        ["wave_height_ft", Number(row.WVHT) * 3.28084, "ft"],
        ["dominant_period_s", Number(row.DPD), "s"],
        ["barometric_pressure_hpa", pres, "hPa"],
        ["water_temp_f", (Number(row.WTMP) * 9) / 5 + 32, "F"]
      ];
      for (const [metric, value, unit] of pairs) {
        if (Number.isFinite(value) && value > -900) {
          readings.push({
            location_id: "eastport-me",
            metric,
            value,
            unit,
            timestamp_utc: ts,
            source_station_id: station
          });
        }
      }
    }
  }

  for (const series of usgs.value?.timeSeries || []) {
    const code = series.variable?.variableCode?.[0]?.value;
    const metric = code === "00060" ? "discharge_cfs" : code === "00065" ? "gage_height_ft" : null;
    const unit = code === "00060" ? "cfs" : "ft";
    if (!metric) continue;
    for (const bucket of series.values || []) {
      for (const p of bucket.value || []) {
        const v = Number(p.value);
        if (!Number.isFinite(v)) continue;
        readings.push({
          location_id: "eastport-me",
          metric,
          value: v,
          unit,
          timestamp_utc: new Date(p.dateTime).toISOString(),
          source_station_id: "01029500"
        });
      }
    }
  }

  const lowerNws = nwsTxt.toLowerCase();
  const hasHazard = ["gale warning", "small craft advisory", "storm warning", "freezing spray advisory"].some((h) =>
    lowerNws.includes(h)
  );
  readings.push({
    location_id: "eastport-me",
    metric: "marine_hazard_flag",
    value: hasHazard ? 1 : 0,
    unit: "flag",
    timestamp_utc: new Date().toISOString(),
    source_station_id: "ANZ050"
  });

  const latestTs =
    readings.reduce((best, r) => (r.timestamp_utc > best ? r.timestamp_utc : best), "1970-01-01T00:00:00.000Z") ||
    new Date().toISOString();
  const status = evaluateStatus(readings);
  const tide = toChartPoints(readings);
  const turningPoints = (hilo.predictions || [])
    .map((d) => {
      const kind = d.type === "H" ? "peak" : d.type === "L" ? "trough" : null;
      return { ts: new Date(`${d.t}Z`).toISOString(), value: Number(d.v), kind };
    })
    .filter((d) => Boolean(d.kind) && Number.isFinite(d.value))
    .map((d) => ({ ts: d.ts, value: d.value, kind: d.kind }))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  return {
    location: config,
    generatedAtUtc: new Date().toISOString(),
    lastUpdatedUtc: latestTs,
    isStale: false,
    readings,
    ruleResult: {
      status: status.status,
      summary: status.summary,
      details: [],
      interpretations: [
        { userType: "boaters", message: "Use conservative trip planning when winds, gusts, or waves climb." },
        { userType: "fishermen", message: "Watch wave and tide timing to keep drift and set control manageable." },
        { userType: "tour_operators", message: "Communicate expected ride comfort and consider protected routes first." }
      ]
    },
    keyChart: {
      metric: "predicted_tide_ft_mllw",
      unit: "ft",
      points: tide,
      turningPoints,
      nowTs: new Date().toISOString()
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

export function getCachedPayload() {
  const mem = getMemory();
  if (mem.value && Date.now() < mem.expiresAt) return mem.value;
  return null;
}

export function setCachedPayload(payload) {
  const mem = getMemory();
  mem.value = payload;
  mem.lastGood = payload;
  mem.expiresAt = Date.now() + TTL_MS;
}

export function getLastGoodPayload() {
  return getMemory().lastGood;
}

export const PIPELINE_CACHE_KEY = CACHE_KEY;
