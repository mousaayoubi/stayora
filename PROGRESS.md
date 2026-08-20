# Stayora — Progress

## Day 1 — Thu Aug 20, 2026 — "The backbone"

**Status: SHIPPED. `POST /chat` returns real live RouteStack hotel search results from a
plain-English query, verified against production with real credentials.**

### What's built

- Node.js + Express (`type: module`), `src/{config,mcp,agents,orchestrator,logging}`.
- `src/mcp/routeStackAuth.js` + `routeStackClient.js` — partner-token auth (HMAC-signed,
  cached, auto-refreshed on 401) and hotel search/rates client, wired to RouteStack's real
  `Travel Booking MCP API`.
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

### Verified live, end to end, with real credentials

`POST /chat {"message":"a hotel in Dubai for 2 adults, checking in next Friday for 3 nights"}`
→ `HTTP 200`, real intent (`checkIn: 2026-08-28`, `checkOut: 2026-08-31`, correctly resolved
against today), 56 real Dubai hotels back from RouteStack with names, live prices, images,
facilities, ratings.

Three real bugs were found and fixed getting here — all in code, not just credential mistakes:

1. **CRLF-corrupted `.env` parsing.** `.env` saved with Windows line endings left a trailing
   `\r` stuck to every value (dotenv only splits on `\n`). Invisible in a terminal, but it
   silently corrupted the RouteStack `apiKey` sent in request bodies (URLs were unaffected -
   URL parsing strips stray CR/LF). Fixed by trimming every value in `src/config/env.js`.
2. **Wrong HMAC encoding.** The OpenAPI spec didn't state the digest encoding; `hex` was
   assumed and was wrong. RouteStack's separate "How To Use Your Keys" guide (pasted by Mousa
   after the account-not-found error persisted with confirmed-clean credentials) showed
   `.digest('base64url')`. Fixed in `src/mcp/routeStackAuth.js`; also switched the nonce to
   `crypto.randomUUID()` to match their sample exactly.
3. **`search-destinations` response shape doesn't match its own OpenAPI docs.** The live
   response has no `_recommendedDestination` convenience field, and candidates use `id` +
   nested `coordinates: {lat, long}` — not the flat `destinationId`/`lat`/`long` the docs
   example showed. Several top-ranked candidates (e.g. the broadest city match) also come back
   with `coordinates: null`. Fixed in `src/mcp/routeStackClient.js#searchDestinations` with a
   documented heuristic: take the first candidate (in the API's own relevance order) that
   actually has coordinates. This is a heuristic, not a confirmed-correct match rule - revisit
   if a Day 2 query picks an obviously wrong destination (e.g. a landmark instead of the city).

### Real per-hotel field shape (search_hotels result, confirmed live - was previously unverified)

Each `result[]` entry: `id`, `name`, `providerName`, `starRating` (nullable), `ourprice`,
`baseprice`, `publishedRate`, `saving`, `savingratio`, `facilities[]` (`{name, id, groupId}`),
`distance`/`distancekm`, `heroImage` (URL), `chain`, `payAtHotel`, `ratetype`, `options`
(`{freeBreakfast, halfBoard, fullBoard, refundable, freeCancellation}`), `contact.address`,
`reviews`, `mainamenity[]`. This is what Day 2's Recommend agent ranks/displays over.

### `get_rates` / `get_policy` — verified live against two real hotels

Both work correctly. `get_rates` returns full hotel content (images, amenities, geo,
descriptions) plus per-room rate groups (price, board basis, bed types, availability).
`get_policy` (after a fix - see below) returns a hotel-level "know before you go" policy text
block plus per-room-rate `refundable` (boolean) / `refundability` (`"Refundable"` /
`"NonRefundable"`) flags.

Confirmed the response shape genuinely varies by hotel/provider - one hotel nested policy text
under `content.policies`, another under `content.eanRating.policies`; one nested rates under
`rooms.groups[]`, another under `availability.groups[]`. This validates `extractPolicy.js`'s
generic tree-walk approach over hardcoding a fixed path - a fixed path would have broken on the
second hotel.

**Bug found and fixed:** `extractPolicySnippets` only collected `string`/`number` leaf values,
but the real policy signals are mostly **booleans** (`refundable: false`, `freeCancellation:
true`) - silently dropped before the fix. It also missed `refundability` because the regex only
matched the literal substring `"refundable"`, not `"refund"`. Fixed both, and matched keys with
an object value (e.g. `policies: {know_before_you_go: "..."}`) are now collected as a whole
instead of only being recursed into (which lost the text since the child key
`know_before_you_go` doesn't itself look policy-related).

### Deviations from the original plan (RouteStack's real behavior vs. its own docs)

- RouteStack's API is namespaced under `/mcp/*` HTTP endpoints (a REST API, not a live MCP
  protocol server itself) — our own `routeStackServer.js` is what actually speaks MCP to the
  orchestrator.
- **No dedicated policy endpoint.** `get_policy` is a best-effort field-name scan
  (`src/mcp/extractPolicy.js`) over the same `get-hotel-details-and-rates` payload `get_rates`
  uses - see above, now verified live and working.
- **No `create_booking` endpoint.** The real Day 2/3 Reserve flow is `revalidate` (reprice) →
  `get-payment-url` (a deep link to an external payment portal) → traveler pays there →
  `get-booking-info` to poll status. Reserve won't get a synchronous "booked" confirmation from
  RouteStack the way the original plan assumed — UI/orchestrator design for Day 2 needs to
  account for a handoff-and-poll flow instead.

### To resume Day 2 (Sun Aug 23)

1. `.env` already has working real credentials for both Anthropic and RouteStack - just
   `npm install && npm start`.
2. `get_rates`/`get_policy` are built and verified live (see above) but not yet wired into the
   orchestrator - Day 1 only wires Understand → `search_hotels`.
3. Then proceed per the original Day 2 plan: RAG layer, Recommend agent, Reserve agent (adjusted
   for the revalidate → payment-URL → poll flow above, not a direct booking call), Postgres
   schema, React+Tailwind chat UI.
