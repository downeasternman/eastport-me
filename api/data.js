import { buildPayload, getCachedPayload, getLastGoodPayload, setCachedPayload } from "./_lib/pipeline.js";

export default async function handler(req, res) {
  try {
    const cached = getCachedPayload();
    if (cached) return res.status(200).json(cached);

    const fresh = await buildPayload();
    setCachedPayload(fresh);
    return res.status(200).json(fresh);
  } catch (error) {
    console.error("api/data failure", error);
    const last = getLastGoodPayload();
    if (last) {
      return res.status(200).json({
        ...last,
        isStale: true,
        staleReason: "Upstream fetch failed. Showing last known good data."
      });
    }
    return res.status(503).json({
      message: "Data unavailable and no last-good cache is available.",
      isStale: true,
      generatedAtUtc: new Date().toISOString()
    });
  }
}
