# Stayora

A premium agentic hotel booking assistant that searches, explains, verifies, and reserves in
one trusted conversation. Solo capstone by Mousa Ayoubi, built over three non-consecutive days
(Thu Aug 20 / Sun Aug 23 / Mon Aug 24, 2026). See `PROGRESS.md` for day-by-day status.

## Architecture

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
              RAG (ranking-guide, policy-explainers,       Recommend (Claude)
              preference-profiles - Ollama embeddings) --> ranked, tradeoffs
                                                            explained per hotel
                                                                     |
                              (traveler picks a hotel + room)       v
                                                                POST /reserve
                                                          revalidate (price check)
                                                                     |
                                                    confirm:true?  --+-- no --> return price
                                                                     |          for the human
                                                                    yes         to look at
                                                                     v
                                                       revalidate again + get_payment_url
                                                                     |
                                                                     v
                                                    payment portal deep link (traveler pays)
```

`Orchestrator -> Agents -> RAG -> MCP -> RouteStack` is the full architecture from the pitch
deck, all wired: Understand -> Search -> enrich (rates + cancellation policy for the top 3
results) -> Recommend (RAG-grounded ranking with an explained tradeoff per hotel - the deck's
core differentiator) -> Reserve (`POST /reserve`, a separate endpoint: revalidate, require
explicit `confirm: true`, revalidate again, hand back a payment portal link - see "Booking is
not a single API call" below for why this isn't a direct booking call).

Reasoning (Understand, Recommend) is Claude throughout. RAG embeddings are the one place this
app uses a local model (Ollama + `nomic-embed-text`) - a deliberate split, not an inconsistency:
embedding a handful of static knowledge docs isn't agentic (no tool-calling reliability at
stake), so there's no reason to pay for a cloud embeddings API for it.

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY, ROUTESTACK_API_KEY, ROUTESTACK_SECRET_KEY
npm run index           # builds data/vectors.json from knowledge/ - needs Ollama running
                         # locally with `ollama pull nomic-embed-text`
npm start
```

`POST /chat` with `{ "message": "a hotel in Dubai for 2 next weekend" }` returns the parsed
intent, the full live RouteStack search result, an `enriched` array (top 3 hotels with rates +
cancellation policy), and a `recommendation` object: `{ranked: [{hotelId, rank, headline,
tradeoff, caveats}], summary}`. A Recommend failure degrades to `recommendation: null` +
`recommendationError` rather than failing the whole request - the search/enrich results are
still useful on their own.

`POST /reserve` with `{hotelId, correlationId, token, checkIn, checkOut, roomId,
recommendationId, publishedRate}` (all from a prior `/chat` response's `enriched[].rates`)
re-checks the price and returns it - add `confirm: true` (same body) to get a real payment
portal URL. Deliberately two calls, not a flag a client could accidentally set: see "Reserve
agent" in `PROGRESS.md`.

`npm run mcp-server` runs the RouteStack MCP server standalone (stdio) for debugging with an
MCP inspector, separate from the Express app spawning it automatically.

## RAG notes

- `knowledge/*.md` (ranking-guide, policy-explainers, preference-profiles) is the whole corpus -
  small and static by design for a 3-day capstone, re-index with `npm run index` after editing.
- `src/rag/chunk.js`'s chunker never lets a chunk span two Markdown headings, even when a
  section is shorter than `chunkSize` (the common case here) - found live: with the original
  word-count-only chunker, a chunk labeled "Business traveler" (the heading active at its first
  word) actually contained mostly "Family traveler" text, because `preference-profiles.md`'s
  short per-archetype sections are smaller than the 160-word chunk window. That silently broke
  both the section citation and retrieval quality (a "family trip" query surfaced the Business
  traveler chunk). Fixed by chunking within each section independently.
- `retrieveTopChunks` falls back to plain keyword search if Ollama is unreachable or the best
  semantic score is below threshold - Recommend still runs (just with weaker grounding) rather
  than failing outright if the local embedding service is down.

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
