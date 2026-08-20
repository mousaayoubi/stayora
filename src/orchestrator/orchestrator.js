/**
 * Orchestrator v1: Understand -> Search -> persist a session -> enrich top
 * results with rates/policy -> Recommend (RAG-backed ranking + tradeoff
 * explanations). Reserve (src/agents/reserve.js) is a separate flow the
 * client enters afterward, using the sessionId returned here.
 */
import { understand, UnderstandError } from "../agents/understand.js";
import { enrichTopHotels } from "../agents/enrich.js";
import { recommend, RecommendError } from "../agents/recommend.js";
import { callRouteStackTool, McpUnavailableError } from "../mcp/client.js";
import { env } from "../config/env.js";
import { createSession } from "../db/repository.js";

export class OrchestratorError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "OrchestratorError";
    this.code = code;
  }
}

const STATUS_BY_CODE = {
  UNDERSTAND_FAILED: 422,
  MCP_UNAVAILABLE: 503,
  ROUTESTACK_SEARCH_FAILED: 502,
  SEARCH_PARSE_FAILED: 502,
};

export function errorStatus(code) {
  return STATUS_BY_CODE[code] ?? 500;
}

/**
 * @param {string} message Raw user message, e.g. "a hotel in Dubai for 2 next weekend".
 * @param {string} [travelerId] Anonymous client-generated UUID (no auth - see db/schema.sql),
 *   used only to tag the persisted session; omit for a fully anonymous session.
 */
export async function handleChat(message, travelerId) {
  const start = Date.now();
  const metrics = {};
  const timings = {};

  let intent;
  try {
    const stepStart = Date.now();
    intent = await understand(message);
    timings.understandMs = Date.now() - stepStart;
  } catch (err) {
    if (err instanceof UnderstandError) {
      throw new OrchestratorError(err.message, "UNDERSTAND_FAILED");
    }
    throw err;
  }

  let search;
  try {
    const stepStart = Date.now();
    const { text, isError } = await callRouteStackTool(
      "search_hotels",
      {
        destinationQuery: intent.destinationQuery,
        checkIn: intent.checkIn,
        checkOut: intent.checkOut,
        rooms: intent.rooms,
        currency: intent.currency,
      },
      { metrics }
    );
    timings.searchMs = Date.now() - stepStart;

    if (isError) {
      throw new OrchestratorError(text, "ROUTESTACK_SEARCH_FAILED");
    }

    try {
      search = JSON.parse(text);
    } catch (parseErr) {
      throw new OrchestratorError(
        `Could not parse RouteStack search result: ${parseErr.message}`,
        "SEARCH_PARSE_FAILED"
      );
    }
  } catch (err) {
    if (err instanceof McpUnavailableError) {
      throw new OrchestratorError(err.message, "MCP_UNAVAILABLE");
    }
    throw err;
  }

  // Persisting the session is best-effort: DATABASE_URL may not be set (see
  // db/pool.js), or Postgres may be briefly unreachable - neither should
  // sink a request that already has a real, useful search result. Reserve
  // can still work without a sessionId (it accepts the raw correlationId/
  // token/dates directly too) - a missing sessionId just means the client
  // has to carry those fields itself instead of Stayora remembering them.
  let sessionId = null;
  if (env.databaseUrl) {
    try {
      const session = await createSession({
        travelerId: travelerId ?? null,
        message,
        destinationQuery: intent.destinationQuery,
        checkIn: intent.checkIn,
        checkOut: intent.checkOut,
        rooms: intent.rooms,
        currency: intent.currency,
        routeStackCorrelationId: search.correlationId,
        routeStackToken: search.token,
      });
      sessionId = session.id;
    } catch (err) {
      console.error("Failed to persist session, continuing without one:", err.message);
    }
  }

  const enrichStart = Date.now();
  const enriched = await enrichTopHotels(
    search.result ?? [],
    {
      correlationId: search.correlationId,
      token: search.token,
      checkIn: intent.checkIn,
      checkOut: intent.checkOut,
      rooms: intent.rooms,
    },
    { metrics }
  );
  timings.enrichMs = Date.now() - enrichStart;

  // A Recommend failure (Claude error, RAG index missing, etc.) shouldn't
  // sink the whole request - the search + enriched shortlist already
  // succeeded and are useful on their own. Degrade to no recommendation
  // rather than a 500 for something the traveler can still act on.
  let recommendation = null;
  let recommendationError = null;
  if (enriched.length > 0) {
    const recommendStart = Date.now();
    try {
      recommendation = await recommend(message, intent, search.result ?? [], enriched, { metrics });
    } catch (err) {
      if (!(err instanceof RecommendError)) throw err;
      console.error("Recommend step failed, degrading to unranked results:", err.message);
      recommendationError = err.message;
    }
    timings.recommendMs = Date.now() - recommendStart;
  }

  timings.totalMs = Date.now() - start;

  return { intent, search, sessionId, enriched, recommendation, recommendationError, timings, metrics };
}
