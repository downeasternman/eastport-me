# Eastport, ME Conditions Today

Mobile-first decision app for Eastport mariners, fishermen, and tour operators.

This app answers one question fast: is it worth going out today?

## What it shows

- Live NOAA tide and water level context for Eastport (`8410140`)
- Marine weather and local station observations (`PSBM1`)
- Offshore wave context from nearby buoy (`44027`)
- Regional freshwater signal from USGS gauge (`01029500`)
- Plain-language status: `good`, `fair`, `caution`, or `poor`

## Stack and architecture

- Vite + TypeScript frontend
- API pipeline layer under `api/` for ingestion, normalization, and rules output
- 10-minute cache strategy with stale fallback behavior
- Vercel cron trigger at `/api/pipeline`
- PWA support via `public/manifest.json` and `public/sw.js`

## Local development

```bash
npm install
npm run dev
```

## Deploy to Vercel

1. Import this GitHub repo into Vercel.
2. Framework preset: `Vite`.
3. Build command: `npm run build`.
4. Output directory: `dist`.
5. Confirm `vercel.json` cron is enabled.

## Data source links

- [NOAA CO-OPS 8410140](https://tidesandcurrents.noaa.gov/stationhome.html?id=8410140)
- [NOAA NDBC PSBM1](https://www.ndbc.noaa.gov/station_page.php?station=psbm1)
- [NOAA NDBC 44027](https://www.ndbc.noaa.gov/station_page.php?station=44027)
- [USGS 01029500](https://waterdata.usgs.gov/monitoring-location/01029500/)
- [NWS Marine ANZ050](https://forecast.weather.gov/shmrn.php?mz=anz050&syn=anz005)
