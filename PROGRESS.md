# Stayora — Progress

## Day 1 — Thu Aug 20, 2026 — "The backbone"

**Status: scaffolded and structurally verified end-to-end against the live RouteStack API.
Blocked only on real credentials — see "To resume Day 2" below.**

### What's built

- Node.js + Express (`type: module`), `src/{config,mcp,agents,orchestrator,logging}`.
- `src/mcp/routeStackAuth.js` + `routeStackClient.js` — partner-token auth (HMAC-signed,
  cached, auto-refreshed on 401) and hotel search/rates client, wired to RouteStack's real
  `Travel Booking MCP API` (docs pasted by Mousa mid-session, not the assumed 3-endpoint shape
  from the original plan — see "Deviations from the original plan" below).
- `src/mcp/routeStackServer.js` — our own MCP server (stdio) exposing `search_hotels`,
  `get_rates`, `get_policy` as clean tools over RouteStack's REST API.
- `src/mcp/client.js` — MCP client wrapper (spawn + retry-once on transport failure), mirrors
  `Week3Day5/src/mcp/client.js`'s pattern.
- `src/agents/understand.js` — NL → structured intent JSON via a forced Claude tool call
  (`claude-sonnet-5`). Resolves relative dates against today, defaults missing occupancy/dates
  and reports what it assumed in `missingInfo`.
- `src/orchestrator/orchestrator.js` — wires Understand → `search_hotels`, typed errors
  (`UNDERSTAND_FAILED` 422, `MCP_UNAVAILABLE` 503, `ROUTESTACK_SEARCH_FAILED` /
  `SEARCH_PARSE_FAILED` 502).
- `src/server.js` — `POST /chat`, `GET /health`, structured JSONL logging to `data/logs.jsonl`
  (same pattern as `Week3Day5/src/logging/logger.js`).

### Verified this session (no real credentials available yet)

- All files pass `node --check`.
- Server starts, fails fast with a clear message when `.env` is missing/incomplete.
- `POST /chat` end-to-end with placeholder keys: reached the real Anthropic API (clean 401 -
  confirms request shape/model id are accepted, only the key is fake).
- Direct MCP tool call (`search_hotels`) with placeholder RouteStack keys: the MCP subprocess
  spawned correctly, env vars passed through, and the HMAC-signed partner-token request reached
  the **real live RouteStack API** at `https://mcp.routestack.ai` and got back a clean, specific
  error — `"Partner account is not found or not active"` — not a malformed-request or
  signature-format error. That's strong evidence the auth request shape and HMAC approach are
  structurally correct; real partner credentials are the only missing piece.

### Deviations from the original plan (found once RouteStack's real docs arrived)

- RouteStack's API is namespaced under `/mcp/*` HTTP endpoints (a REST API, not a live MCP
  protocol server itself) — our own `routeStackServer.js` is what actually speaks MCP to the
  orchestrator.
- **No dedicated policy endpoint.** `get_policy` is a best-effort field-name scan
  (`src/mcp/extractPolicy.js`) over the same `get-hotel-details-and-rates` payload `get_rates`
  uses, since RouteStack's docs mark that response as too large to show a schema for. Revisit
  once a real response is seen.
- **No `create_booking` endpoint.** The real Day 2/3 Reserve flow is `revalidate` (reprice) →
  `get-payment-url` (a deep link to an external payment portal) → traveler pays there →
  `get-booking-info` to poll status. Reserve won't get a synchronous "booked" confirmation from
  RouteStack the way the original plan assumed — UI/orchestrator design for Day 2 needs to
  account for a handoff-and-poll flow instead.
- `search_hotels`'s per-hotel result shape (name, price, image, rating field names) is
  unverified — RouteStack's docs example was empty/truncated. First live call with real
  credentials should be inspected before building the Recommend agent's ranking/display logic
  on top of it.

### To resume Day 2 (Sun Aug 23)

1. Get real RouteStack partner credentials (`ROUTESTACK_API_KEY`, `ROUTESTACK_SECRET_KEY`) and
   a real `ANTHROPIC_API_KEY` into `.env` (copy from `.env.example`).
2. Run `npm start`, `POST /chat` with a real query, and inspect the actual `search_hotels`
   response shape — confirm/fix field names before building ranking logic on top of it.
3. Then proceed per the original Day 2 plan: RAG layer, Recommend agent, Reserve agent (adjusted
   for the revalidate → payment-URL → poll flow above, not a direct booking call), Postgres
   schema, React+Tailwind chat UI.
