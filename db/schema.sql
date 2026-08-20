-- Stayora — minimal Postgres schema (Day 2).
--
-- Three tables, matching the pitch deck's PostgreSQL scope minus the parts
-- explicitly cut from the 3-day build (no accounts/passwords - "no full
-- auth system" is a named scope decision, not an oversight). `traveler_id`
-- throughout is a bare, client-generated UUID (e.g. stored in a cookie) -
-- an anonymous identifier to group a traveler's sessions/preferences
-- together, not an authenticated account.
--
-- Idempotent: safe to run against a fresh database or re-run against an
-- already-migrated one. Run via `npm run db:migrate`.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gives us gen_random_uuid()

-- ---------------------------------------------------------------------------
-- sessions: one row per /chat request that reached a live RouteStack search.
-- Holds the parsed intent and the RouteStack correlationId/token needed to
-- make any follow-up call (get_rates, get_policy, revalidate, ...) for that
-- same listing session - see src/mcp/routeStackServer.js's "session
-- threading" note for why those two fields have to be persisted verbatim
-- rather than re-derived.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    traveler_id                 UUID,
    message                     TEXT NOT NULL,
    destination_query           TEXT NOT NULL,
    check_in                    DATE NOT NULL,
    check_out                   DATE NOT NULL,
    rooms                       JSONB NOT NULL,
    currency                    TEXT NOT NULL DEFAULT 'USD',
    route_stack_correlation_id  TEXT,
    route_stack_token           TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sessions_dates_valid CHECK (check_out > check_in)
);

CREATE INDEX IF NOT EXISTS idx_sessions_traveler_id ON sessions (traveler_id);
CREATE INDEX IF NOT EXISTS idx_sessions_correlation_id ON sessions (route_stack_correlation_id);

-- ---------------------------------------------------------------------------
-- reservations: one row per room a traveler took through the Reserve flow
-- (src/agents/reserve.js). `status` tracks the two-phase flow directly -
-- 'price_checked' after phase 1 (revalidate only), 'ready_for_payment'
-- after phase 2 (confirm: true, payment URL generated), 'confirmed' once
-- get_booking_info confirms payment went through (not wired yet - see
-- PROGRESS.md), 'cancelled'/'expired' for the rest. There is no RouteStack
-- "confirmed booking" response to store synchronously - route_stack_booking_id
-- is filled in later, once the traveler completes payment and a booking id
-- becomes available.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id              UUID NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    hotel_id                TEXT NOT NULL,
    hotel_name              TEXT,
    room_id                 TEXT NOT NULL,
    recommendation_id       TEXT NOT NULL,
    published_rate          NUMERIC(10, 2) NOT NULL CHECK (published_rate > 0),
    currency                TEXT NOT NULL DEFAULT 'USD',
    check_in                DATE NOT NULL,
    check_out               DATE NOT NULL,
    status                  TEXT NOT NULL DEFAULT 'price_checked'
                                 CHECK (status IN (
                                     'price_checked', 'ready_for_payment',
                                     'confirmed', 'cancelled', 'expired'
                                 )),
    checkout_url             TEXT,
    route_stack_booking_id   TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reservations_dates_valid CHECK (check_out > check_in)
);

CREATE INDEX IF NOT EXISTS idx_reservations_session_id ON reservations (session_id);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (status);

-- ---------------------------------------------------------------------------
-- saved_preferences: one row per anonymous traveler_id. `traveler_type`
-- mirrors knowledge/preference-profiles.md's archetypes - nullable, because
-- ranking-guide.md is explicit that Recommend should not force a request
-- into an archetype it doesn't clearly match.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_preferences (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    traveler_id           UUID NOT NULL UNIQUE,
    traveler_type         TEXT CHECK (traveler_type IN (
                               'business', 'family', 'budget_leisure', 'luxury_leisure'
                           )),
    preferred_amenities   TEXT[] NOT NULL DEFAULT '{}',
    notes                 TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
