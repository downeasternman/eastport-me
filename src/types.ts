export type SourceType = "noaa_tides" | "noaa_weather" | "usgs_gauge" | "nws_marine";
export type Status = "good" | "fair" | "caution" | "poor";

export interface LocationSource {
  type: SourceType;
  station_id: string;
  metrics: string[];
}

export interface LocationConfig {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
  user_types: string[];
  primary_metric: string;
  sources: LocationSource[];
  rules: string;
  tip_url: string;
  contact_url: string;
  seo: {
    title: string;
    description: string;
    activity_keywords: string[];
  };
}

export interface NormalizedReading {
  location_id: string;
  metric: string;
  value: number;
  unit: string;
  timestamp_utc: string;
  source_station_id: string;
}

export interface RuleResult {
  status: Status;
  summary: string;
  details: string[];
  interpretations: Array<{ userType: string; message: string }>;
}

export interface TimeseriesPoint {
  ts: string;
  value: number;
}

export interface AppPayload {
  location: LocationConfig;
  generatedAtUtc: string;
  lastUpdatedUtc: string;
  isStale: boolean;
  staleReason?: string;
  readings: NormalizedReading[];
  ruleResult: RuleResult;
  keyChart: {
    metric: string;
    unit: string;
    points: TimeseriesPoint[];
    nowTs: string;
  };
  sources: Array<{ name: string; url: string }>;
}
