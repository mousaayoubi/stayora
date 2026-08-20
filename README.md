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
                                    search_hotels
                                             |
                                             v
                                  RouteStack Travel Booking API
```

`Orchestrator -> Agents -> RAG -> MCP -> RouteStack` is the full architecture from the pitch
deck; Day 1 only wires Understand -> Search. Recommend (RAG-backed ranking) and Reserve
(revalidate + confirm + book) land Day 2.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY, ROUTESTACK_API_KEY, ROUTESTACK_SECRET_KEY
npm start
```

`POST /chat` with `{ "message": "a hotel in Dubai for 2 next weekend" }` returns the parsed
intent plus a live RouteStack hotel search result.

`npm run mcp-server` runs the RouteStack MCP server standalone (stdio) for debugging with an
MCP inspector, separate from the Express app spawning it automatically.

## RouteStack integration notes

RouteStack's own docs (`docs/EXTERNAL_MCP_INTEGRATION.md` in their system) describe the API;
a few things worth knowing when extending this:

- **Auth**: `POST /mcp/auth/partner-token` exchanges `{ apiKey, timestamp, nonce, hmac }` for a
  24h bearer JWT. The HMAC algorithm (HMAC-SHA256, hex) is assumed per convention since
  RouteStack's docs don't state it explicitly - `src/mcp/routeStackAuth.js` is the first place
  to check if auth fails against the live API.
- **Session threading**: `search-hotels` returns a `correlationId` + `token` that must be
  replayed on every follow-up call for that listing session (pagination, rates, policy,
  booking). Our `search_hotels` MCP tool returns them to the caller rather than hiding them in
  server state, so `get_rates`/`get_policy` need them passed back in.
- **No dedicated policy endpoint**: `get_policy` is a best-effort extraction from the same
  `get-hotel-details-and-rates` payload `get_rates` uses (see `src/mcp/extractPolicy.js`).
  RouteStack's docs mark that response as too large to show a full schema, so exact field names
  are unverified until we see a live response.
- **Booking is not a single API call**: there's no `create_booking` endpoint. The real flow is
  `revalidate` (reprice) -> `get-payment-url` (returns a deep link to an external payment
  portal) -> the traveler completes payment there -> `get-booking-info` to check status
  afterward. This changes the Day 2 Reserve agent design from the original plan's assumption of
  a direct `create_booking` call - it hands off to a payment portal URL instead.
