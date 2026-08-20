/**
 * Enriches the top few search_hotels results with rates and policy info,
 * so /chat can return something closer to "here are your options, priced
 * and with cancellation terms" rather than a bare hotel list.
 *
 * This is NOT the Recommend agent from the pitch deck - there's no RAG or
 * preference-based ranking here, just "take the top N in whatever order
 * RouteStack returned them and fetch details for those." Ranking/explaining
 * tradeoffs is Day 2 scope; this only avoids fetching rates for all 50+
 * search results when a handful is what any UI would show first anyway.
 *
 * Efficiency note: get_rates and get_policy (the MCP tools) both call
 * RouteStack's get-hotel-details-and-rates under the hood - the identical
 * endpoint, same params. Calling both per hotel would fetch the same
 * payload twice. Instead this calls get_rates once per hotel and derives
 * policy locally from that same payload via extractPolicySnippets, so
 * get_policy stays available as its own MCP tool (e.g. for a future "what's
 * the cancellation policy on X" follow-up question) without this path
 * paying for a second network round trip it doesn't need.
 */
import { callRouteStackTool } from "../mcp/client.js";
import { extractPolicySnippets } from "../mcp/extractPolicy.js";

const DEFAULT_TOP_N = 3;

/**
 * @param {object[]} hotels search_hotels' `result` array.
 * @param {object} session { correlationId, token, checkIn, checkOut, rooms } from the same
 *   search_hotels response/intent - required to call get_rates for these hotels.
 * @param {object} [options]
 * @param {number} [options.topN]
 * @param {object} [options.metrics] Accumulator - passed through to callRouteStackTool.
 * @returns {Promise<Array<{hotelId: string, name: string, rates?: object, policy?: object[], error?: string}>>}
 */
export async function enrichTopHotels(hotels, session, options = {}) {
  const topN = options.topN ?? DEFAULT_TOP_N;
  const { metrics } = options;
  const picked = hotels.slice(0, topN);

  return Promise.all(
    picked.map(async (hotel) => {
      try {
        const { text, isError } = await callRouteStackTool(
          "get_rates",
          {
            hotelId: hotel.id,
            correlationId: session.correlationId,
            token: session.token,
            checkIn: session.checkIn,
            checkOut: session.checkOut,
            rooms: session.rooms,
          },
          { metrics }
        );

        if (isError) {
          return { hotelId: hotel.id, name: hotel.name, error: text };
        }

        const rates = JSON.parse(text);
        const policy = extractPolicySnippets(rates);
        return { hotelId: hotel.id, name: hotel.name, rates, policy };
      } catch (err) {
        // A single hotel's rates being unavailable (stale listing, an
        // McpUnavailableError, a malformed payload) shouldn't fail the
        // whole /chat response when the base search already succeeded -
        // record it per-hotel and let the others through.
        return { hotelId: hotel.id, name: hotel.name, error: err.message };
      }
    })
  );
}

export { DEFAULT_TOP_N };
