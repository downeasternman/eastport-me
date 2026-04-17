import { fetchJsonWithRetry } from "./http";

interface UsgsResponse {
  value?: {
    timeSeries?: Array<{
      variable?: { variableCode?: Array<{ value?: string }> };
      values?: Array<{ value?: Array<{ value: string; dateTime: string }> }>;
    }>;
  };
}

const CODE_TO_METRIC: Record<string, { metric: string; unit: string }> = {
  "00060": { metric: "discharge_cfs", unit: "cfs" },
  "00065": { metric: "gage_height_ft", unit: "ft" }
};

export async function fetchUsgsGauge(siteNo: string): Promise<Array<{ ts: string; metric: string; value: number; unit: string }>> {
  const base = import.meta.env.DEV ? "/api-usgs" : "https://waterservices.usgs.gov";
  const url = `${base}/nwis/iv/?format=json&sites=${siteNo}&parameterCd=00060,00065`;
  const data = await fetchJsonWithRetry<UsgsResponse>(url);
  const out: Array<{ ts: string; metric: string; value: number; unit: string }> = [];
  for (const series of data.value?.timeSeries || []) {
    const code = series.variable?.variableCode?.[0]?.value || "";
    const mapped = CODE_TO_METRIC[code];
    if (!mapped) continue;
    for (const bucket of series.values || []) {
      for (const p of bucket.value || []) {
        const value = Number(p.value);
        if (!Number.isFinite(value)) continue;
        out.push({ ts: new Date(p.dateTime).toISOString(), metric: mapped.metric, value, unit: mapped.unit });
      }
    }
  }
  return out;
}
