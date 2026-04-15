import { fetchTextWithRetry } from "./http";

export async function fetchNwsMarine(zoneId: string): Promise<{ hazardFlag: number; summary: string; ts: string }> {
  const url = `https://forecast.weather.gov/shmrn.php?mz=${zoneId}&syn=anz005`;
  const text = await fetchTextWithRetry(url);
  const lower = text.toLowerCase();
  const hazards = ["gale warning", "small craft advisory", "storm warning", "freezing spray advisory"];
  const active = hazards.filter((h) => lower.includes(h));
  const summaryLine = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find((line) => line.length > 60 && /winds|seas|advisory|warning/i.test(line));

  return {
    hazardFlag: active.length ? 1 : 0,
    summary: summaryLine || (active.length ? active.join(", ") : "No marine hazard text found."),
    ts: new Date().toISOString()
  };
}
