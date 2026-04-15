import type { NormalizedReading, RuleResult, Status } from "../types";

function latest(readings: NormalizedReading[], metric: string): number | null {
  const item = readings
    .filter((r) => r.metric === metric)
    .sort((a, b) => Date.parse(b.timestamp_utc) - Date.parse(a.timestamp_utc))[0];
  return item ? item.value : null;
}

export function evaluateEastport(readings: NormalizedReading[]): RuleResult {
  const wind = latest(readings, "wind_speed_kts");
  const gust = latest(readings, "wind_gust_kts");
  const wave = latest(readings, "wave_height_ft");
  const hazard = latest(readings, "marine_hazard_flag");

  let score = 0;
  if ((wind ?? 0) > 18) score += 1;
  if ((gust ?? 0) > 25) score += 1;
  if ((wave ?? 0) > 4) score += 1;
  if ((hazard ?? 0) > 0) score += 2;

  const status: Status = score >= 4 ? "poor" : score >= 3 ? "caution" : score >= 1 ? "fair" : "good";
  const summaryByStatus: Record<Status, string> = {
    good: "Good conditions for most small-boat and charter activity.",
    fair: "Fair conditions: check timing and route before departure.",
    caution: "Use caution today: rougher marine conditions are likely.",
    poor: "Poor boating conditions right now. Delay or choose protected water."
  };

  const details = [
    wind !== null ? `Wind ${wind.toFixed(1)} kts` : "Wind unavailable",
    gust !== null ? `Gust ${gust.toFixed(1)} kts` : "Gust unavailable",
    wave !== null ? `Wave height ${wave.toFixed(1)} ft` : "Wave height unavailable",
    hazard ? "Marine advisory/warning text detected" : "No active marine hazard text detected"
  ];

  return {
    status,
    summary: summaryByStatus[status],
    details,
    interpretations: [
      {
        userType: "boaters",
        message:
          status === "good"
            ? "Harbor and transit windows look workable for most small craft."
            : "Plan sheltered routes, tighter windows, and conservative go/no-go calls."
      },
      {
        userType: "fishermen",
        message:
          status === "poor"
            ? "Expect uncomfortable drift and harder station-keeping."
            : "Fishable windows exist, but monitor wind and tide shift closely."
      },
      {
        userType: "tour_operators",
        message:
          status === "caution" || status === "poor"
            ? "Set clear passenger expectations and consider shorter protected trips."
            : "Tour conditions are generally manageable with standard marine checks."
      }
    ]
  };
}
