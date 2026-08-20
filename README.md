# Stayora

A premium agentic hotel booking assistant that searches, explains, verifies, and reserves in
one trusted conversation. Solo capstone by Mousa Ayoubi, built over three non-consecutive days
(Thu Aug 20 / Sun Aug 23 / Mon Aug 24, 2026). See `PROGRESS.md` for day-by-day status.

## Architecture (Day 1 slice)

```
User message --> Understand (Claude) --> structured intent
                                             |
                                             v
                              RouteStack MCP tool layer (stdio)
                                 search_hotels --> top 3 results
                                             |
                                             v
                                  enrich (get_rates + policy)
                                             |
                                             v
                               priced, policy-annotated shortlist
```

`Orchestrator -> Agents -> RAG -> MCP -> RouteStack` is the full architecture from the pitch
deck. Day 1 wires Understand -> Search -> a lightweight enrichment pass (rates + cancellation
policy for the top 3 results, in whatever order RouteStack returned them - not a ranked
recommendation). RAG-backed ranking/tradeoff explanations (Recommend) and revalidate + confirm +
book (Reserve) land Day 2.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY, ROUTESTACK_API_KEY, ROUTESTACK_SECRET_KEY
npm start
```

`POST /chat` with `{ "message": "a hotel in Dubai for 2 next weekend" }` returns the parsed
intent, the full live RouteStack search result, and an `enriched` array: the top 3 hotels with
rates and a best-effort cancellation policy attached.

`npm run mcp-server` runs the RouteStack MCP server standalone (stdio) for debugging with an
MCP inspector, separate from the Express app spawning it automatically.

## RouteStack integration notes

RouteStack's OpenAPI docs describe the intended API shape, but several things only became clear
against the live account - worth knowing before extending this further:

- **Auth**: `POST /mcp/auth/partner-token` exchanges `{ apiKey, timestamp, nonce, hmac }` for a
  24h bearer JWT. `hmac` is HMAC-SHA256 of `apiKey:timestamp:nonce`, **base64url-encoded** (the
  OpenAPI docs don't state the encoding at all; confirmed against RouteStack's separate "How To
  Use Your Keys" guide, not the OpenAPI spec). See `src/mcp/routeStackAuth.js`.
- **Session threading**: `search-hotels` returns a `correlationId` + `token` that must be
  replayed on every follow-up call for that listing session (pagination, rates, policy,
  booking). Our `search_hotels` MCP tool returns them to the caller rather than hiding them in
  server state, so `get_rates`/`get_policy` need them passed back in.
- **`search-destinations`'s live response doesn't match its OpenAPI example**: no
  `_recommendedDestination` convenience field, and candidates use `id` + nested
  `coordinates: {lat, long}` instead of flat `destinationId`/`lat`/`long`. Several top-ranked
  candidates come back with `coordinates: null`. `routeStackClient.js#searchDestinations` picks
  the first candidate (in the API's own order) that actually has coordinates - a heuristic, not
  a guaranteed-correct match.
- **No dedicated policy endpoint**: `get_policy` is a best-effort extraction from the same
  `get-hotel-details-and-rates` payload `get_rates` uses (see `src/mcp/extractPolicy.js`),
  verified live against two different hotels - it returns a "know before you go" text block plus
  per-room `refundable`/`refundability` flags. The nesting path genuinely varies by
  hotel/provider (`content.policies` vs. `content.eanRating.policies`), which is why this is a
  generic tree-walk rather than a fixed field path.
- **`enrichTopHotels` (`src/agents/enrich.js`) calls `get_rates` once per hotel and derives
  policy locally from that same payload**, rather than also calling the `get_policy` MCP tool -
  both hit the identical RouteStack endpoint, so calling both would fetch the same ~400KB
  payload twice per hotel for no new data. `get_policy` stays available as its own MCP tool for
  callers that only need policy (e.g. a future "what's the cancellation policy on X" follow-up).
- **Booking is not a single API call**: there's no `create_booking` endpoint. The real flow is
  `revalidate` (reprice) -> `get-payment-url` (returns a deep link to an external payment
  portal) -> the traveler completes payment there -> `get-booking-info` to check status
  afterward. This changes the Day 2 Reserve agent design from the original plan's assumption of
  a direct `create_booking` call - it hands off to a payment portal URL instead.
