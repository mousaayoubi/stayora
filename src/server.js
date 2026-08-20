import express from "express";

import { env } from "./config/env.js";
import { handleChat, OrchestratorError, errorStatus } from "./orchestrator/orchestrator.js";
import { logRequest, newRequestId } from "./logging/logger.js";

const app = express();
app.use(express.json());

app.post("/chat", async (req, res) => {
  const requestId = newRequestId();
  const message = req.body?.message;

  let result;
  try {
    result = await handleChat(message);
  } catch (err) {
    const code = err instanceof OrchestratorError ? err.code : "UNKNOWN";
    const status = err instanceof OrchestratorError ? errorStatus(code) : 500;
    if (!(err instanceof OrchestratorError)) {
      console.error(`[${requestId}] unexpected orchestrator failure:`, err);
    }

    await logRequest({
      timestamp: new Date().toISOString(),
      requestId,
      message,
      success: false,
      errorCode: code,
      error: err.message,
    });

    return res.status(status).json({ ok: false, requestId, error: err.message, code });
  }

  await logRequest({
    timestamp: new Date().toISOString(),
    requestId,
    message,
    success: true,
    intent: result.intent,
    hotelCount: result.search?.count ?? result.search?.result?.length ?? null,
    correlationId: result.search?.correlationId ?? null,
    timings: result.timings,
    metrics: result.metrics,
  });

  res.json({ ok: true, requestId, ...result });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(env.port, () => {
  console.log(`Stayora listening on http://localhost:${env.port}`);
});
