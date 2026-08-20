/**
 * Orchestrator v1 (Day 1 scope): Understand -> Search -> enrich top results
 * with rates/policy.
 *
 * Recommend (RAG-backed ranking + tradeoff explanations) and Reserve
 * (revalidate + confirm + book) are Day 2 additions - enrichTopHotels below
 * takes the top few results in whatever order RouteStack returned them, not
 * a ranked recommendation.
 */
import { understand, UnderstandError } from "../agents/understand.js";
import { enrichTopHotels } from "../agents/enrich.js";
import { callRouteStackTool, McpUnavailableError } from "../mcp/client.js";

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
 */
export async function handleChat(message) {
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

  timings.totalMs = Date.now() - start;

  return { intent, search, enriched, timings, metrics };
}
