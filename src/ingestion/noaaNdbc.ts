import { fetchTextWithRetry } from "./http";

function parseLatestRows(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((x) => x.trim());
  const header = lines.find((line) => line.includes("YY") && line.includes("MM") && line.includes("DD"));
  if (!header) return [];
  const headerIdx = lines.indexOf(header);
  const keys = header.replace(/^#\s*/, "").trim().split(/\s+/);
  return lines
    .slice(headerIdx + 1)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= keys.length)
    .slice(0, 200)
    .map((cols) => {
      const row: Record<string, string> = {};
      keys.forEach((k, i) => {
        row[k] = cols[i];
      });
      return row;
    });
}

function rowTs(row: Record<string, string>): string | null {
  const yy = Number(row.YY);
  const mm = Number(row.MM);
  const dd = Number(row.DD);
  const hh = Number(row.hh);
  const minute = Number(row.mm);
  if (![yy, mm, dd, hh, minute].every(Number.isFinite)) return null;
  return new Date(Date.UTC(yy, mm - 1, dd, hh, minute)).toISOString();
}

export async function fetchNoaaNdbc(stationId: string): Promise<Array<{ ts: string; metric: string; value: number; unit: string }>> {
  const base = import.meta.env.DEV ? "/api-noaa-ndbc" : "https://www.ndbc.noaa.gov";
  const text = await fetchTextWithRetry(`${base}/data/realtime2/${stationId}.txt`);
  const rows = parseLatestRows(text);
  const points: Array<{ ts: string; metric: string; value: number; unit: string }> = [];
  for (const row of rows) {
    const ts = rowTs(row);
    if (!ts) continue;
    const wdir = Number(row.WDIR);
    const wvht = Number(row.WVHT);
    const dpd = Number(row.DPD);
    const wspd = Number(row.WSPD);
    const gst = Number(row.GST);
    const pres = Number(row.PRES);
    const wtmp = Number(row.WTMP);
    if (Number.isFinite(wdir) && wdir > -900) points.push({ ts, metric: "wind_direction_deg", value: wdir, unit: "deg" });
    if (Number.isFinite(wvht) && wvht > -900) points.push({ ts, metric: "wave_height_ft", value: wvht * 3.28084, unit: "ft" });
    if (Number.isFinite(dpd) && dpd > -900) points.push({ ts, metric: "dominant_period_s", value: dpd, unit: "s" });
    if (Number.isFinite(wspd) && wspd > -900) points.push({ ts, metric: "wind_speed_kts", value: wspd, unit: "kts" });
    if (Number.isFinite(gst) && gst > -900) points.push({ ts, metric: "wind_gust_kts", value: gst, unit: "kts" });
    if (Number.isFinite(pres) && pres > -900) points.push({ ts, metric: "barometric_pressure_hpa", value: pres, unit: "hPa" });
    if (Number.isFinite(wtmp) && wtmp > -900) points.push({ ts, metric: "water_temp_f", value: (wtmp * 9) / 5 + 32, unit: "F" });
  }
  return points;
}
