import express from "express";

import { env } from "./config/env.js";
import { handleChat, OrchestratorError, errorStatus } from "./orchestrator/orchestrator.js";
import { reserve, ReserveError, errorStatus as reserveErrorStatus } from "./agents/reserve.js";
import { logRequest, newRequestId } from "./logging/logger.js";

const app = express();
app.use(express.json());

app.post("/chat", async (req, res) => {
  const requestId = newRequestId();
  const message = req.body?.message;
  const travelerId = req.body?.travelerId;

  let result;
  try {
    result = await handleChat(message, travelerId);
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
    sessionId: result.sessionId ?? null,
    enrichedHotelIds: result.enriched?.map((h) => h.hotelId) ?? [],
    enrichedErrors: result.enriched?.filter((h) => h.error).length ?? 0,
    recommendedTopHotelId: result.recommendation?.ranked?.[0]?.hotelId ?? null,
    recommendationError: result.recommendationError ?? null,
    timings: result.timings,
    metrics: result.metrics,
  });

  res.json({ ok: true, requestId, ...result });
});

// Deliberately separate from /chat: reserving a specific room is a
// structured action against an existing search session (either a sessionId
// from a prior /chat response, or hotelId/roomId/correlationId/token
// passed directly), not a new free-text question. Two-phase by design -
// see reserve.js - so the UI's "confirm-before-book" step is a real second
// request, not just a client-side checkbox in front of a call that would
// have booked either way.
app.post("/reserve", async (req, res) => {
  const requestId = newRequestId();
  const body = req.body ?? {};

  let result;
  try {
    result = await reserve(body);
  } catch (err) {
    const code = err instanceof ReserveError ? err.code : "UNKNOWN";
    const status = err instanceof ReserveError ? reserveErrorStatus(code) : 500;
    if (!(err instanceof ReserveError)) {
      console.error(`[${requestId}] unexpected reserve failure:`, err);
    }

    await logRequest({
      timestamp: new Date().toISOString(),
      requestId,
      route: "reserve",
      sessionId: body.sessionId ?? null,
      hotelId: body.hotelId,
      roomId: body.roomId,
      confirm: Boolean(body.confirm),
      success: false,
      errorCode: code,
      error: err.message,
    });

    return res.status(status).json({ ok: false, requestId, error: err.message, code });
  }

  await logRequest({
    timestamp: new Date().toISOString(),
    requestId,
    route: "reserve",
    sessionId: body.sessionId ?? null,
    reservationId: result.reservationId ?? null,
    hotelId: body.hotelId,
    roomId: body.roomId,
    confirm: Boolean(body.confirm),
    success: true,
    phase: result.phase,
  });

  res.json({ ok: true, requestId, ...result });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(env.port, () => {
  console.log(`Stayora listening on http://localhost:${env.port}`);
});
