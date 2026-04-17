import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api-noaa-coops": {
        target: "https://api.tidesandcurrents.noaa.gov",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-noaa-coops/, "")
      },
      "/api-noaa-ndbc": {
        target: "https://www.ndbc.noaa.gov",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-noaa-ndbc/, "")
      },
      "/api-usgs": {
        target: "https://waterservices.usgs.gov",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-usgs/, "")
      },
      "/api-nws": {
        target: "https://forecast.weather.gov",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-nws/, "")
      }
    }
  }
});
