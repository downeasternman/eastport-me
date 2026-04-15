import { fetchJsonWithRetry } from "./http";

interface CoopsResponse {
  data?: Array<{ t: string; v?: string }>;
  predictions?: Array<{ t: string; v: string }>;
}

export async function fetchNoaaCoops(stationId: string): Promise<{
  observed: Array<{ ts: string; value: number }>;
  predictions: Array<{ ts: string; value: number }>;
}> {
  const now = new Date();
  const begin = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")} ${String(
      d.getUTCHours()
    ).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

  const observedUrl =
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_level&application=waterapps&format=json` +
    `&time_zone=gmt&units=english&interval=6&datum=MLLW&station=${stationId}&begin_date=${encodeURIComponent(fmt(begin))}` +
    `&end_date=${encodeURIComponent(fmt(now))}`;
  const predUrl =
    `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=waterapps&format=json` +
    `&time_zone=gmt&units=english&interval=h&datum=MLLW&station=${stationId}&begin_date=${encodeURIComponent(fmt(now))}` +
    `&end_date=${encodeURIComponent(fmt(end))}`;

  const [observedRes, predRes] = await Promise.all([
    fetchJsonWithRetry<CoopsResponse>(observedUrl),
    fetchJsonWithRetry<CoopsResponse>(predUrl)
  ]);

  return {
    observed: (observedRes.data || [])
      .map((d) => ({ ts: new Date(`${d.t}Z`).toISOString(), value: Number(d.v) }))
      .filter((d) => Number.isFinite(d.value)),
    predictions: (predRes.predictions || [])
      .map((d) => ({ ts: new Date(`${d.t}Z`).toISOString(), value: Number(d.v) }))
      .filter((d) => Number.isFinite(d.value))
  };
}
