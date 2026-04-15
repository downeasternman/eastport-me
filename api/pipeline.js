import { buildPayload, setCachedPayload } from "./_lib/pipeline.js";

export default async function handler(req, res) {
  try {
    const payload = await buildPayload();
    setCachedPayload(payload);
    return res.status(200).json({ ok: true, generatedAtUtc: payload.generatedAtUtc });
  } catch (error) {
    console.error("api/pipeline failure", error);
    return res.status(500).json({ ok: false, error: "Pipeline refresh failed." });
  }
}
