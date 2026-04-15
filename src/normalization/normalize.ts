import type { NormalizedReading } from "../types";

export function normalizePoints(
  locationId: string,
  sourceStationId: string,
  points: Array<{ ts: string; metric: string; value: number; unit: string }>
): NormalizedReading[] {
  return points.map((p) => ({
    location_id: locationId,
    metric: p.metric,
    value: p.value,
    unit: p.unit,
    timestamp_utc: p.ts,
    source_station_id: sourceStationId
  }));
}

export function normalizeWaterLevel(
  locationId: string,
  sourceStationId: string,
  observed: Array<{ ts: string; value: number }>,
  predictions: Array<{ ts: string; value: number }>
): NormalizedReading[] {
  const o = observed.map((p) => ({
    location_id: locationId,
    metric: "water_level_ft_mllw",
    value: p.value,
    unit: "ft",
    timestamp_utc: p.ts,
    source_station_id: sourceStationId
  }));
  const pred = predictions.map((p) => ({
    location_id: locationId,
    metric: "predicted_tide_ft_mllw",
    value: p.value,
    unit: "ft",
    timestamp_utc: p.ts,
    source_station_id: sourceStationId
  }));
  return [...o, ...pred];
}
