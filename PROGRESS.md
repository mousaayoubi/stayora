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
- `src/agents/enrich.js` — takes `search_hotels`' top 3 results (provider order, not a ranked
  recommendation) and fetches rates + a locally-derived cancellation policy for each, one
  `get_rates` call per hotel (not also `get_policy` - see "Efficiency" note below).
- `src/orchestrator/orchestrator.js` — wires Understand → `search_hotels` → `enrichTopHotels`,
  typed errors (`UNDERSTAND_FAILED` 422, `MCP_UNAVAILABLE` 503, `ROUTESTACK_SEARCH_FAILED` /
  `SEARCH_PARSE_FAILED` 502). A single hotel's enrichment failing doesn't fail the whole
  request - it's recorded as `{hotelId, error}` in the `enriched` array instead.
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

### `get_rates`/`get_policy` wired into the orchestrator

`handleChat` now runs Understand → `search_hotels` → `enrichTopHotels` (top 3 results, calls
`get_rates` once per hotel and derives policy locally from that same payload via
`extractPolicySnippets` - see README's "Efficiency" note for why `get_policy` isn't also called
per hotel). Response gains an `enriched: [{hotelId, name, rates, policy, error?}]` array.

Verified live end to end: `POST /chat` for the same Dubai query → `HTTP 200` in ~12s
(`understandMs: 4674, searchMs: 4241, enrichMs: 3094` - the 3 `get_rates` calls run in
parallel), all 3 hotels enriched successfully with real rates and 3–14 policy entries each, no
errors. `metrics.mcpCalls: 4` (1 search + 3 rates, as intended - not 7, confirming the
"don't double-fetch" design works).

## Day 2 — "Recommend, reserve, and a face"

**Status: RAG layer + Recommend agent SHIPPED and verified live. Reserve agent, Postgres, UI
still to come.**

### RAG layer

- `knowledge/{ranking-guide,policy-explainers,preference-profiles}.md` — Stayora's actual domain
  knowledge: how to weigh price vs. cancellation-vs-trip-distance vs. location vs. amenities,
  what refundable/pay-at-hotel/mandatory-fee terms actually mean, and what business/family/
  budget/luxury travelers each weigh most.
- `src/rag/{loadDocuments,chunk,similarity,retrieve,buildIndex}.js` — adapted directly from
  `Week3Day5`'s verified RAG pipeline (load → chunk → embed → store; semantic search with a
  keyword-search fallback).
- `src/rag/ollamaEmbeddings.js` — embeddings via local Ollama (`nomic-embed-text`), confirmed
  already running on this machine from `Week3Day5`. **Reasoning stays 100% Claude** - this is
  the one deliberate exception, scoped strictly to embedding static knowledge docs, which isn't
  agentic and carries none of the local-model tool-calling reliability risk the original
  Claude-over-Ollama decision was about.
- `npm run index` builds `data/vectors.json` (17 chunks from the 3 docs).

**Real bug found and fixed:** the chunker (adapted from Week3Day5) never lets a chunk span two
Markdown headings. Without that fix, `preference-profiles.md`'s short per-archetype sections
(~80-100 words) were smaller than the 160-word chunk window, so a chunk labeled "Business
traveler" (the heading active at its first word) was mostly "Family traveler" text underneath -
broke both the section citation and retrieval quality. Verified live before/after: a "family
trip, free cancellation" query surfaced the Business-traveler chunk before the fix, the correct
Family-traveler chunk after.

### Recommend agent

`src/agents/recommend.js` — takes the enriched shortlist, retrieves relevant RAG context for the
traveler's message, and asks Claude (forced tool call, `claude-sonnet-5`) to rank the shortlist
with a named tradeoff and caveats per hotel. Summarizes each ~400KB `get_rates` payload down to
the handful of facts a ranking decision needs (price, star rating, distance, refundability mix,
amenities, cleaned "know before you go" text) before it ever reaches the prompt.

Wired into `orchestrator.js` after `enrichTopHotels`. A Recommend failure degrades to
`recommendation: null` + `recommendationError` rather than failing the whole request - the
search/enrich results are still useful without a ranking on top.

**Verified live end to end**, family-trip query ("2 adults and 2 kids... we want free
cancellation since plans might change"): `HTTP 200` in ~34s (`understandMs: 3031, searchMs:
11403, enrichMs: 3538, recommendMs: 15672`). The ranking was genuinely good - ranked the
all-refundable hotel first specifically because of the stated cancellation priority, correctly
distinguished "hotel-level freeCancellation" from "this specific room is refundable" for the
other two (grounded in `policy-explainers.md`'s explicit distinction), and every hotel's caveats
honestly flagged missing data (no confirmed family amenities, no policy text available) instead
of guessing - exactly the behavior `ranking-guide.md` asked for.

**Latency note:** ~34s end to end is workable for a demo but real - mostly Claude's Recommend
call (16s, generating a detailed structured response) plus RouteStack search variance (11s this
run vs. 4s on Day 1's test). UI needs a loading state; this is not going to feel instant.

### Still to come (Day 2)

1. **Reserve agent**: revalidate (reprice) → `get-payment-url` (external payment portal deep
   link, not a direct booking call - see Day 1's finding above) → the traveler completes payment
   there → `get-booking-info` to poll status. Needs explicit confirmation before revalidate/
   payment-url are called, per the original plan.
2. **Postgres schema**: `sessions`, `reservations`, `saved_preferences` - not started.
3. **React + Tailwind chat UI**: message thread, comparison cards showing the ranked
   recommendation, confirm-before-book flow - not started. No auth UI, per original scope.
