/**
 * Low-level RouteStack HTTP client. One function per /mcp/hotel/* endpoint
 * we currently use; each attaches the partner bearer token and retries
 * exactly once with a forced token refresh on a 401 (handles the token
 * being revoked or expiring mid-session, not just clock skew).
 *
 * This file has no knowledge of MCP-the-protocol - it is plain REST
 * plumbing. routeStackServer.js is what exposes these as MCP tools.
 */
import { env } from "../config/env.js";
import { getPartnerToken } from "./routeStackAuth.js";

export class RouteStackError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.name = "RouteStackError";
    this.status = status;
    this.code = code;
  }
}

async function post(path, body) {
  const attempt = async (forceToken) => {
    const token = await getPartnerToken({ force: forceToken });
    const response = await fetch(`${env.routeStackBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    return { response, data };
  };

  let { response, data } = await attempt(false);

  if (response.status === 401) {
    ({ response, data } = await attempt(true));
  }

  if (!response.ok || data?.success === false) {
    throw new RouteStackError(
      `RouteStack ${path} failed (${response.status}): ${data?.message ?? "no body"}`,
      { status: response.status, code: data?.code }
    );
  }

  return data;
}

/**
 * Resolves a free-text location to a destinationId/lat/long.
 * Per RouteStack's docs, use `_recommendedDestination` for feeding into
 * search-hotels - not an individual Hotel row from `result` - unless the
 * user named one specific property.
 */
export async function searchDestinations(query, type = "DESTINATION") {
  const data = await post("/mcp/hotel/search-destinations", { query, type });
  const candidates = data.result ?? [];

  // RouteStack's docs show a convenience `_recommendedDestination` field
  // with flat destinationId/lat/long - in practice (live account) that
  // field is absent, and candidates instead use `id` + nested
  // `coordinates: {lat, long}`, with the top/broadest matches often having
  // `coordinates: null`. Heuristic: take the first candidate, in the API's
  // own relevance order, that actually has usable coordinates. A sharper
  // "did the user mean this specific city vs. landmark vs. property" match
  // can replace this once more real query patterns are seen.
  const withCoords = candidates.find(
    (c) => c.coordinates?.lat != null && c.coordinates?.long != null
  );

  const recommended =
    data._recommendedDestination ??
    data._citySearchDestination ??
    (withCoords && {
      destinationId: withCoords.id,
      lat: withCoords.coordinates.lat,
      long: withCoords.coordinates.long,
      type: withCoords.type,
      fullName: withCoords.fullName,
    }) ??
    null;

  return { candidates, recommended };
}

/**
 * Searches hotels for a resolved destination + stay dates + room occupancy.
 * Pass `correlationId`/`token`/`nextResultsKey` (all from a prior response)
 * to page through the same search session instead of starting a new one.
 */
export async function searchHotels(params) {
  const data = await post("/mcp/hotel/search-hotels", params);
  return data.result;
}

/**
 * Combined hotel content + rooms/rates in one call (RouteStack's
 * recommended path when you need both, rather than calling
 * get-hotel-details and get-rooms-and-rates separately for the same step).
 * Requires the `token`/`correlationId` from the search-hotels response for
 * this listing session.
 */
export async function getHotelDetailsAndRates(params) {
  const data = await post("/mcp/hotel/get-hotel-details-and-rates", params);
  return data.result;
}

/**
 * Re-checks price/availability for one specific room recommendation
 * immediately before payment. RouteStack's docs: "For best results call
 * revalidate immediately before generating a payment URL" - so this is
 * called both as its own price-check step and again right before
 * get-payment-url, not just once.
 */
export async function revalidate(params) {
  const data = await post("/mcp/hotel/revalidate", params);
  return data.result ?? data;
}

/**
 * Generates the external payment portal URL for a specific room
 * recommendation. This is RouteStack's actual "book" step - there is no
 * synchronous create_booking call; the traveler completes payment at this
 * URL and the booking is confirmed on RouteStack's side from there.
 */
export async function getPaymentUrl(params) {
  const data = await post("/mcp/hotel/get-payment-url", params);
  return data;
}

/** Fetches booking status/details by RouteStack booking id. */
export async function getBookingInfo(bookingId) {
  const data = await post("/mcp/hotel/get-booking-info", { bookingId });
  return data.result ?? data;
}
