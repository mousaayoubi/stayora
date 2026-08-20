/**
 * Reserve agent: re-checks price immediately before payment and requires
 * explicit confirmation before ever generating a payment link - adapted
 * from the original plan's "re-check price, confirm, then book" design to
 * RouteStack's real flow (there is no synchronous create_booking call; see
 * PROGRESS.md's Day 1 findings - the actual "book" step is a payment
 * portal deep link the traveler completes payment at).
 *
 * Two-phase by construction, not just by convention:
 *   1. `confirm` not true: revalidate only, return the current (possibly
 *      drifted) price for a human to look at and decide.
 *   2. `confirm: true`: revalidate again - RouteStack's own guidance is to
 *      do this immediately before generating a payment URL, not just once
 *      earlier - then generate the payment portal link.
 * There is no code path from "check price" to "get a payable link" that
 * skips the confirm flag; get_payment_url is never called unless the
 * caller explicitly passed confirm: true.
 */
import { callRouteStackTool, McpUnavailableError } from "../mcp/client.js";

export class ReserveError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ReserveError";
    this.code = code;
  }
}

const STATUS_BY_CODE = {
  VALIDATION_FAILED: 400,
  MCP_UNAVAILABLE: 503,
  REVALIDATE_FAILED: 502,
  PAYMENT_URL_FAILED: 502,
};

export function errorStatus(code) {
  return STATUS_BY_CODE[code] ?? 500;
}

const REQUIRED_FIELDS = [
  "hotelId",
  "correlationId",
  "token",
  "checkIn",
  "checkOut",
  "roomId",
  "recommendationId",
];

/**
 * @param {object} params
 * @param {string} params.hotelId
 * @param {string} [params.hotelName]
 * @param {string} params.correlationId Same listing session as the original search_hotels call.
 * @param {string} params.token
 * @param {string} params.checkIn
 * @param {string} params.checkOut
 * @param {string} params.roomId The chosen room's `id` from a get_rates response.
 * @param {string} params.recommendationId The chosen room's `recommendationId` from get_rates.
 * @param {number} params.publishedRate The chosen room's `publishedRate` from get_rates.
 * @param {boolean} [params.confirm] false/omitted = price-check only; true = proceed to payment.
 * @param {object} [options] { metrics }
 */
export async function reserve(params, options = {}) {
  const { metrics } = options;
  const { hotelId, hotelName, correlationId, token, checkIn, checkOut, roomId, recommendationId, publishedRate, confirm } = params ?? {};

  for (const field of REQUIRED_FIELDS) {
    if (!params?.[field]) {
      throw new ReserveError(`Missing required field: ${field}`, "VALIDATION_FAILED");
    }
  }
  if (!(publishedRate > 0)) {
    throw new ReserveError("publishedRate must be a positive number.", "VALIDATION_FAILED");
  }

  const revalidation = await callTool(
    "revalidate_rate",
    { hotelId, correlationId, token, recommendationId, publishedRate },
    metrics,
    "REVALIDATE_FAILED"
  );

  if (!confirm) {
    return {
      phase: "revalidated",
      requiresConfirmation: true,
      revalidation,
      message:
        "Price has been re-checked. Call again with confirm: true (same parameters) to get " +
        "the payment link - this step never generates one on its own.",
    };
  }

  // RouteStack's guidance is to revalidate again right before generating
  // the payment URL, not to rely on an earlier check - so this runs even
  // though a caller who followed phase 1 already revalidated once.
  const finalRevalidation = await callTool(
    "revalidate_rate",
    { hotelId, correlationId, token, recommendationId, publishedRate },
    metrics,
    "REVALIDATE_FAILED"
  );

  const payment = await callTool(
    "get_payment_url",
    { hotelId, hotelName, correlationId, token, recommendationId, roomId, checkIn, checkOut, publishedRate },
    metrics,
    "PAYMENT_URL_FAILED"
  );

  return {
    phase: "ready_for_payment",
    revalidation: finalRevalidation,
    checkoutUrl: payment.url,
    checkoutMode: payment.checkoutMode ?? null,
  };
}

async function callTool(name, args, metrics, errorCode) {
  let result;
  try {
    result = await callRouteStackTool(name, args, { metrics });
  } catch (err) {
    if (err instanceof McpUnavailableError) throw new ReserveError(err.message, "MCP_UNAVAILABLE");
    throw err;
  }

  if (result.isError) {
    throw new ReserveError(result.text, errorCode);
  }

  try {
    return JSON.parse(result.text);
  } catch (parseErr) {
    throw new ReserveError(`Could not parse ${name} result: ${parseErr.message}`, errorCode);
  }
}
