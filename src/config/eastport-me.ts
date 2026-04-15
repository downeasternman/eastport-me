import type { LocationConfig } from "../types";

const eastportConfig: LocationConfig = {
  id: "eastport-me",
  name: "Eastport, ME",
  coordinates: { lat: 44.906, lng: -66.989 },
  user_types: ["boaters", "fishermen", "tour_operators"],
  primary_metric: "water_level_ft_mllw",
  sources: [
    {
      type: "noaa_tides",
      station_id: "8410140",
      metrics: ["water_level_ft_mllw", "predicted_tide_ft_mllw"]
    },
    {
      type: "noaa_weather",
      station_id: "PSBM1",
      metrics: ["wind_speed_kts", "wind_gust_kts", "water_temp_f"]
    },
    {
      type: "noaa_weather",
      station_id: "44027",
      metrics: ["wave_height_ft", "dominant_period_s"]
    },
    {
      type: "nws_marine",
      station_id: "ANZ050",
      metrics: ["marine_hazard_flag", "marine_forecast_text"]
    },
    {
      type: "usgs_gauge",
      station_id: "01029500",
      metrics: ["discharge_cfs", "gage_height_ft"]
    }
  ],
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

export default eastportConfig;
