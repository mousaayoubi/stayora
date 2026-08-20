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

**Status: RAG layer, Recommend agent, Reserve agent, Postgres schema (wired into `/chat` and
`/reserve`), and the React+Tailwind UI are all built. Everything except the UI is verified live
end to end with real data; the UI is verified by build success + code review only (browser
extension unavailable this session - see its section below) and should be clicked through for
real before Day 3's demo.**

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

### Reserve agent

`src/agents/reserve.js` + 3 new MCP tools (`revalidate_rate`, `get_payment_url`,
`get_booking_info` - `src/mcp/routeStackServer.js`/`routeStackClient.js`) + `POST /reserve`
(`src/server.js`, deliberately separate from `/chat` - reserving is a structured action against
an existing search session, not a new free-text question).

Two-phase by construction, not just convention, per the original plan's "re-check price,
require explicit confirmation, then book":

1. `confirm` not `true` (or omitted): calls `revalidate_rate` only, returns the current price
   for a human to look at. `get_payment_url` is never called from this path - there is no code
   path from "check price" to "get a payable link" that skips the flag.
2. `confirm: true`: revalidates **again** (RouteStack's own guidance: do this immediately before
   generating a payment URL, not just rely on an earlier check), then calls `get_payment_url`
   and returns the payment portal deep link.

Adapted from the original plan's "then calls `create_booking`" to RouteStack's real flow (Day
1 finding: no synchronous booking call exists) - the traveler completes payment at the returned
URL; `get_booking_info` is available to poll status afterward but isn't wired into `/reserve`
itself yet (that's UI/Day-3 territory - checking whether a payment actually completed).

**Verified live end to end** against a real room (City Stay Prime Hotel Apartment, Dubai):
phase 1 returned real revalidated pricing, room description, and cancellation-policy rules
without ever touching payment; phase 2 (`confirm: true`) returned a real
`https://travel.routestack.ai/hotel/guests?query=...` payment deep link. Validation also
verified: a request missing `correlationId` returns `400 VALIDATION_FAILED` before any
RouteStack call is made.

### Postgres schema

`db/schema.sql` (3 tables: `sessions`, `reservations`, `saved_preferences` - idempotent, run via
`npm run db:migrate`) + `src/db/{pool,migrate,repository}.js`. No accounts/passwords anywhere -
"no full auth system" is a named scope decision, not an oversight; `traveler_id` is a bare
client-generated UUID (anonymous, e.g. a cookie), not an authenticated identity.

- `sessions`: one row per `/chat` request, holds the parsed intent plus RouteStack's
  `correlationId`/`token` (needed for any follow-up call in that listing session).
- `reservations`: one row per room taken through `/reserve`, `status` tracks its two-phase flow
  directly (`price_checked` → `ready_for_payment` → `confirmed`/`cancelled`/`expired`).
- `saved_preferences`: one row per `traveler_id`, `traveler_type` mirrors
  `knowledge/preference-profiles.md`'s archetypes (nullable - `ranking-guide.md` is explicit
  that Recommend shouldn't force an archetype a request didn't support).

Live database: a free Supabase project. **Two real infra gotchas hit and resolved getting
connected** (neither is a code bug, both worth remembering for Day 3):
1. Supabase's **direct connection** host (`db.<ref>.supabase.co`) resolves to an
   **IPv6-only** address - `ENOTFOUND` on this network (no IPv6 route). Fixed by using
   Supabase's **connection pooler** host instead (`aws-0-<region>.pooler.supabase.com`), which
   supports IPv4.
2. Session pooler (not transaction pooler) was the deliberate choice - this app holds a
   persistent `pg.Pool` from a long-running server, not serverless/edge functions, so
   transaction pooler's main benefit (cheap short-lived connections at scale) doesn't apply, and
   session pooler avoids its real limitations (no session-level `SET`, multi-statement DDL
   scripts like `schema.sql` are safer under full connection semantics).

**Real bug found and fixed via live verification** (not just "the migration ran"): `pg`'s
default `DATE` column parser returns a JS `Date` at **local midnight**, which shifts the
calendar date backward once serialized to JSON (`toISOString()` is always UTC) - `check_in:
"2026-08-28"` round-tripped through the repository layer came back as
`"2026-08-27T21:00:00.000Z"`. Fixed in `src/db/pool.js` with
`types.setTypeParser(types.builtins.DATE, v => v)`, returning the raw `YYYY-MM-DD` string
instead - matches what the app already produces everywhere else (`understand.js`,
`search_hotels`), so no reformatting needed on the way back out either. Re-verified live after
the fix: dates round-trip exactly.

Verified live end to end: `createSession` → `createReservation` →
`updateReservationStatus` → `getReservationById` → `listReservationsBySession` all confirmed
against the real Supabase DB; `upsertPreferences`'s `ON CONFLICT (traveler_id)` update path
confirmed (second call updated the existing row, didn't duplicate it); the `sessions_dates_valid`
CHECK constraint confirmed rejecting `checkOut < checkIn`. All verification rows deleted
afterward - the schema is live and empty, ready for real use.

### Repository wired into /chat and /reserve

`/chat` now persists a `sessions` row right after a successful RouteStack search (best-effort -
a DB hiccup or unset `DATABASE_URL` degrades to `sessionId: null` rather than failing a request
that already has a real search result). Accepts an optional `travelerId` in the request body to
tag the session (still anonymous - no accounts, just an opaque client-generated UUID).

`/reserve` gained a second way to identify what's being booked: pass `sessionId` (from a prior
`/chat` response) instead of `correlationId`/`token`/`checkIn`/`checkOut` directly - those get
resolved from the persisted session. The explicit-fields form still works unchanged (useful when
`DATABASE_URL` isn't set, or a session wasn't persisted). Unlike session persistence,
**resolving `sessionId` is NOT best-effort** - a missing/invalid one is a real `404
SESSION_NOT_FOUND`, since there's nothing to fall back to once the caller has chosen that path.

Reservation persistence tracks the two-phase flow directly: phase 1 creates a `reservations` row
(`status: 'price_checked'`) and returns its `reservationId`; passing that same `reservationId`
back on the phase-2 (`confirm: true`) call updates the *same* row to `'ready_for_payment'` +
`checkout_url` rather than creating a duplicate. Reservation writes are best-effort like session
writes - a persistence failure degrades to `reservationId: null`/unchanged rather than blocking
the price check or payment link.

**Verified live end to end**, real round trip: `/chat` (with `travelerId`) → persisted `sessions`
row confirmed in Supabase → `/reserve` phase 1 using **only** `sessionId` (no correlationId/
token/dates passed) → real revalidated price + a `reservations` row created → phase 2 with
`confirm: true` + the same `reservationId` → real payment URL + the *same* row updated to
`ready_for_payment` (`updated_at > created_at`, `listReservationsBySession` confirmed exactly 1
row, not 2). `SESSION_NOT_FOUND` (404) confirmed for a bogus `sessionId`. All verification data
cleaned up afterward.

One false alarm during verification, not a bug: an early sessionId-path test failed with
RouteStack's `"pricecheck resolver not data found"` - looked like a wiring bug at first, but a
fresh back-to-back retry with no delay succeeded, and a same-timing test using explicit fields
(no sessionId) also succeeded - pointing to RouteStack's own rate cache expiring during the
extra inspection steps between calls, not anything wrong with sessionId resolution.

### React + Tailwind chat UI

`client/` - a Vite + React + Tailwind app, separate `package.json` (own dependency tree, doesn't
bloat the API server's). Not a toy static page: real component structure, a real build step,
Tailwind's actual utility pipeline (not a CDN class dump).

- `App.jsx` holds the message list; `MessageThread.jsx` renders user/assistant bubbles and, for
  an assistant turn with results, a horizontally-scrolling row of `HotelCard.jsx` - one per
  `recommendation.ranked` entry (falls back to `enriched`'s plain order if Recommend degraded,
  same as the backend's own graceful-degradation contract).
- `HotelCard.jsx` is where the confirm-before-book flow actually lives: each card owns its own
  `idle -> checking -> revalidated -> confirming -> ready_for_payment` state and calls
  `/reserve` twice, mirroring `reserve.js`'s two real phases exactly (see `PROGRESS.md`'s Reserve
  agent section) rather than a client-side flag in front of one call. A card auto-picks the
  cheapest room for that hotel to book (labeled "cheapest available room" - a deliberate MVP
  simplification, no room-picker sub-UI yet) and shows the real payment URL as a link once
  confirmed.
- `api.js`'s `getTravelerId()` generates and persists a bare anonymous UUID in `localStorage`
  (no login) - passed as `/chat`'s optional `travelerId` so a returning visitor's sessions group
  together in Postgres.
- Dev: `npm run client:dev` runs Vite's dev server (port 5173) proxying `/chat`, `/reserve`,
  `/health` to Express (port 3000 - run `npm run dev` there too) - see `client/vite.config.js`.
  Production: `npm run build:client` builds `client/dist`, which `src/server.js` now serves as
  static files automatically when present - `npm start` alone is then a complete demo.

**Verification note**: the Claude-in-Chrome browser extension wasn't connected this session, so
this was NOT visually clicked through in a real browser - verified instead via a clean
production build (`vite build`, 36 modules, no errors/warnings), confirming Express serves the
built `index.html`/JS/CSS at their exact built sizes, and careful code review against the exact
response shapes `/chat`/`/reserve` are already live-verified to return (earlier in this
session). Mousa should open `http://localhost:3000` and click through the real flow before
treating this as demo-ready - a build succeeding is not the same as a UI actually working
correctly for a user.

A moderate/high `npm audit` advisory exists in `client/`'s devDependencies (`esbuild` <=0.24.2
via `vite` 5.x - allows a malicious website to read the dev server's responses). Dev-server-only,
not present in the production build Express serves; not fixed here since the fix bumps to
`vite@8` (breaking) for a capstone timeline. Worth revisiting past Day 3.

### Still to come

1. Wiring `get_booking_info` into a "did the payment go through" check somewhere (UI polling
   after handing off to the payment URL, most likely) - not started.
2. `saved_preferences` isn't read or written from any live route yet - no endpoint asks for or
   uses a traveler's saved preferences. Natural fit once there's a preferences panel, or
   Recommend reading them to skip re-asking on a returning traveler's second session.
3. A real room-picker per hotel (the UI currently auto-books the cheapest room only).
