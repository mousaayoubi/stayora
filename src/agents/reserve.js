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
 *
 * Persistence (a `reservations` row tracking this same two-phase flow) is
 * best-effort throughout, same principle as the session persistence in
 * orchestrator.js: a DB hiccup shouldn't block a traveler from getting
 * their price check or payment link. The one place persistence IS load-
 * bearing is resolving `sessionId` -> correlationId/token/dates - if the
 * caller chose to rely on a stored session instead of passing those fields
 * itself, failing to read that session is a real error, not something to
 * silently continue past.
 */
import { callRouteStackTool, McpUnavailableError } from "../mcp/client.js";
import { getSessionById, createReservation, updateReservationStatus } from "../db/repository.js";
import { DatabaseNotConfiguredError } from "../db/pool.js";

export class ReserveError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ReserveError";
    this.code = code;
  }
}

const STATUS_BY_CODE = {
  VALIDATION_FAILED: 400,
  SESSION_NOT_FOUND: 404,
  DATABASE_NOT_CONFIGURED: 503,
  MCP_UNAVAILABLE: 503,
  REVALIDATE_FAILED: 502,
  PAYMENT_URL_FAILED: 502,
};

export function errorStatus(code) {
  return STATUS_BY_CODE[code] ?? 500;
}

// hotelId/roomId/recommendationId/publishedRate are always required.
// correlationId/token/checkIn/checkOut are required UNLESS sessionId is
// given, in which case they're resolved from the persisted session instead.
const ALWAYS_REQUIRED = ["hotelId", "roomId", "recommendationId"];
const SESSION_DERIVED = ["correlationId", "token", "checkIn", "checkOut"];

/**
 * @param {object} params
 * @param {string} [params.sessionId] A sessionId from a prior /chat response - if given,
 *   correlationId/token/checkIn/checkOut are read from that persisted session instead of
 *   needing to be passed explicitly.
 * @param {string} [params.reservationId] A reservationId from this reserve flow's own phase-1
 *   response - pass it back on the phase-2 (confirm: true) call so the same reservations row is
 *   updated rather than a new one created. Optional even with sessionId (a fresh row is created
 *   if omitted).
 * @param {string} params.hotelId
 * @param {string} [params.hotelName]
 * @param {string} [params.correlationId] Same listing session as the original search_hotels call.
 * @param {string} [params.token]
 * @param {string} [params.checkIn]
 * @param {string} [params.checkOut]
 * @param {string} params.roomId The chosen room's `id` from a get_rates response.
 * @param {string} params.recommendationId The chosen room's `recommendationId` from get_rates.
 * @param {number} params.publishedRate The chosen room's `publishedRate` from get_rates.
 * @param {boolean} [params.confirm] false/omitted = price-check only; true = proceed to payment.
 * @param {object} [options] { metrics }
 */
export async function reserve(params, options = {}) {
  const { metrics } = options;
  let { hotelId, hotelName, correlationId, token, checkIn, checkOut, roomId, recommendationId, publishedRate, confirm, sessionId, reservationId } = params ?? {};

  for (const field of ALWAYS_REQUIRED) {
    if (!params?.[field]) {
      throw new ReserveError(`Missing required field: ${field}`, "VALIDATION_FAILED");
    }
  }
  if (!(publishedRate > 0)) {
    throw new ReserveError("publishedRate must be a positive number.", "VALIDATION_FAILED");
  }

  if (sessionId) {
    const session = await resolveSession(sessionId);
    correlationId = correlationId ?? session.route_stack_correlation_id;
    token = token ?? session.route_stack_token;
    checkIn = checkIn ?? session.check_in;
    checkOut = checkOut ?? session.check_out;
  }

  const resolved = { correlationId, token, checkIn, checkOut };
  for (const field of SESSION_DERIVED) {
    if (!resolved[field]) {
      throw new ReserveError(
        `Missing required field: ${field} (pass it directly, or pass sessionId to resolve it from a stored session).`,
        "VALIDATION_FAILED"
      );
    }
  }

  const revalidation = await callTool(
    "revalidate_rate",
    { hotelId, correlationId, token, recommendationId, publishedRate },
    metrics,
    "REVALIDATE_FAILED"
  );

  reservationId = await persistReservationStatus(reservationId, {
    sessionId,
    hotelId,
    hotelName,
    roomId,
    recommendationId,
    publishedRate,
    checkIn,
    checkOut,
    status: "price_checked",
  });

  if (!confirm) {
    return {
      phase: "revalidated",
      requiresConfirmation: true,
      revalidation,
      reservationId,
      message:
        "Price has been re-checked. Call again with confirm: true (same parameters, plus " +
        "reservationId if one was returned) to get the payment link - this step never " +
        "generates one on its own.",
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

  reservationId = await persistReservationStatus(reservationId, {
    sessionId,
    hotelId,
    hotelName,
    roomId,
    recommendationId,
    publishedRate,
    checkIn,
    checkOut,
    status: "ready_for_payment",
    checkoutUrl: payment.url,
  });

  return {
    phase: "ready_for_payment",
    revalidation: finalRevalidation,
    checkoutUrl: payment.url,
    checkoutMode: payment.checkoutMode ?? null,
    reservationId,
  };
}

/**
 * Looks up a session by id - required (not best-effort) when the caller
 * relies on sessionId to resolve correlationId/token/dates, since without
 * it there's nothing to fall back to.
 */
async function resolveSession(sessionId) {
  let session;
  try {
    session = await getSessionById(sessionId);
  } catch (err) {
    if (err instanceof DatabaseNotConfiguredError) {
      throw new ReserveError(err.message, "DATABASE_NOT_CONFIGURED");
    }
    throw new ReserveError(`Failed to look up sessionId ${sessionId}: ${err.message}`, "SESSION_NOT_FOUND");
  }
  if (!session) {
    throw new ReserveError(`No session found for sessionId ${sessionId}.`, "SESSION_NOT_FOUND");
  }
  return session;
}

/**
 * Creates or updates the reservations row for this flow, best-effort - a
 * write failure is logged and swallowed rather than thrown, since losing
 * the persisted audit trail shouldn't block a traveler from getting their
 * price check or payment link. Returns the reservationId to carry forward
 * (unchanged if nothing was persisted, e.g. no sessionId and no
 * reservationId were given, or the write failed).
 */
async function persistReservationStatus(reservationId, fields) {
  const { sessionId, status, checkoutUrl, ...rest } = fields;

  try {
    if (reservationId) {
      await updateReservationStatus(reservationId, { status, checkoutUrl });
      return reservationId;
    }
    if (sessionId) {
      const row = await createReservation({ sessionId, status, ...rest });
      return row.id;
    }
  } catch (err) {
    console.error("Failed to persist reservation status, continuing without it:", err.message);
  }
  return reservationId ?? null;
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
