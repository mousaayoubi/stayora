#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  searchDestinations,
  searchHotels,
  getHotelDetailsAndRates,
  RouteStackError,
} from "./routeStackClient.js";
import { extractPolicySnippets } from "./extractPolicy.js";

/**
 * RouteStack MCP Server
 *
 * Wraps RouteStack's Travel Booking API (a partner-token-authenticated REST
 * API, itself namespaced under /mcp/*) behind our own MCP tools, so the
 * orchestrator/agents call `search_hotels`, `get_rates`, `get_policy` and
 * never touch RouteStack's auth flow, correlationId/token session-threading,
 * or endpoint shapes directly.
 *
 *   Tools: search_hotels, get_rates, get_policy
 *
 * Session threading: RouteStack's search-hotels response returns a
 * correlationId/token that must be replayed on every follow-up call for
 * that same listing session (pagination, get_rates, get_policy). We don't
 * hide that behind hidden server-side state - callers receive and pass
 * back correlationId/token explicitly, so a caller can run multiple
 * concurrent searches without them colliding.
 */
const server = new McpServer({
  name: "routestack-mcp-server",
  version: "1.0.0",
});

const roomSchema = z.object({
  adults: z.number().int().min(1).max(10),
  children: z.number().int().min(0).max(10).default(0),
});

// ---------------------------------------------------------------------------
// Tool: search_hotels
// ---------------------------------------------------------------------------
server.registerTool(
  "search_hotels",
  {
    title: "Search hotels",
    description:
      "Resolves a free-text destination (e.g. 'Dubai', 'Avari Apartments, Pune') and searches " +
      "RouteStack for hotels matching stay dates and room occupancy. Returns a correlationId " +
      "and token that must be passed to get_rates/get_policy for the same listing session.",
    inputSchema: {
      destinationQuery: z.string().min(1).max(200),
      checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkIn must be YYYY-MM-DD."),
      checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "checkOut must be YYYY-MM-DD."),
      rooms: z.array(roomSchema).min(1).max(8),
      currency: z.string().length(3).default("USD"),
    },
  },
  async ({ destinationQuery, checkIn, checkOut, rooms, currency }) => {
    try {
      const { recommended, candidates } = await searchDestinations(destinationQuery);
      const destination = recommended ?? candidates[0];

      if (!destination) {
        return {
          content: [
            { type: "text", text: `No RouteStack destination matched "${destinationQuery}".` },
          ],
          isError: true,
        };
      }

      const result = await searchHotels({
        destinationId: destination.destinationId,
        destinationType: destination.type,
        lat: destination.lat,
        long: destination.long,
        checkIn,
        checkOut,
        rooms,
        roomCount: rooms.length,
        currency,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { destination: destination.fullName ?? destinationQuery, ...result },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      return toolError(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: get_rates
// ---------------------------------------------------------------------------
server.registerTool(
  "get_rates",
  {
    title: "Get hotel rooms and rates",
    description:
      "Gets rooms, rate plans, and pricing for one hotel from a prior search_hotels result. " +
      "Requires the hotelId, correlationId, and token from that search_hotels response.",
    inputSchema: {
      hotelId: z.string().min(1),
      correlationId: z.string().min(1),
      token: z.string().min(1),
      checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      rooms: z.array(roomSchema).min(1).max(8),
    },
  },
  async (args) => {
    try {
      const result = await getHotelDetailsAndRates({ ...args, roomCount: args.rooms.length });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return toolError(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: get_policy
// ---------------------------------------------------------------------------
server.registerTool(
  "get_policy",
  {
    title: "Get hotel cancellation/booking policy",
    description:
      "Best-effort cancellation/booking policy lookup for one hotel. RouteStack has no " +
      "dedicated policy endpoint, so this reads the same get-hotel-details-and-rates payload " +
      "as get_rates and extracts anything under a policy-like field name.",
    inputSchema: {
      hotelId: z.string().min(1),
      correlationId: z.string().min(1),
      token: z.string().min(1),
      checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      rooms: z.array(roomSchema).min(1).max(8),
    },
  },
  async (args) => {
    try {
      const result = await getHotelDetailsAndRates({ ...args, roomCount: args.rooms.length });
      const snippets = extractPolicySnippets(result);

      if (snippets.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No policy-like fields found in RouteStack's response for this hotel.",
            },
          ],
        };
      }

      return { content: [{ type: "text", text: JSON.stringify(snippets, null, 2) }] };
    } catch (error) {
      return toolError(error);
    }
  }
);

function toolError(error) {
  const message =
    error instanceof RouteStackError ? error.message : `Unexpected error: ${error.message}`;
  return { content: [{ type: "text", text: message }], isError: true };
}

// ---------------------------------------------------------------------------
// Transport: stdio
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout is reserved for MCP protocol messages - all logging must go to
  // stderr, or it will corrupt the stdio JSON-RPC stream.
  console.error("RouteStack MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting RouteStack MCP server:", error);
  process.exit(1);
});
