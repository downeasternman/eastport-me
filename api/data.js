import { buildPayload, getCachedPayload, getLastGoodPayload, setCachedPayload } from "./_lib/pipeline.js";

export default async function handler(req, res) {
  try {
    const cached = getCachedPayload();
    if (cached) {
      // #region agent log
      fetch("http://127.0.0.1:7880/ingest/15016d89-948c-4052-8cdb-ef26db9d1a03",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"f3ef61"},body:JSON.stringify({sessionId:"f3ef61",runId:"initial",hypothesisId:"H2",location:"api/data.js:8",message:"api/data served cached payload",data:{hasLocation:!!cached?.location,hasSeo:!!cached?.location?.seo,isStale:!!cached?.isStale,readingsCount:Array.isArray(cached?.readings)?cached.readings.length:-1},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      return res.status(200).json(cached);
    }

    const fresh = await buildPayload();
    // #region agent log
    fetch("http://127.0.0.1:7880/ingest/15016d89-948c-4052-8cdb-ef26db9d1a03",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"f3ef61"},body:JSON.stringify({sessionId:"f3ef61",runId:"initial",hypothesisId:"H4",location:"api/data.js:15",message:"api/data built fresh payload",data:{hasLocation:!!fresh?.location,hasSeo:!!fresh?.location?.seo,readingsCount:Array.isArray(fresh?.readings)?fresh.readings.length:-1},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    setCachedPayload(fresh);
    return res.status(200).json(fresh);
  } catch (error) {
    console.error("api/data failure", error);
    const last = getLastGoodPayload();
    // #region agent log
    fetch("http://127.0.0.1:7880/ingest/15016d89-948c-4052-8cdb-ef26db9d1a03",{method:"POST",headers:{"Content-Type":"application/json","X-Debug-Session-Id":"f3ef61"},body:JSON.stringify({sessionId:"f3ef61",runId:"initial",hypothesisId:"H4",location:"api/data.js:22",message:"api/data catch path",data:{errorMessage:error instanceof Error?error.message:String(error),hasLastGood:!!last,lastHasSeo:!!last?.location?.seo},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
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
