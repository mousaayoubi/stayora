/**
 * All direct SQL for sessions/reservations/saved_preferences lives here -
 * matching Week3Day5's "Repositories are responsible for all direct
 * communication with PostgreSQL. No other layer is allowed to query the
 * database directly" convention (knowledge/architecture.md). Not yet
 * called from the live request path (/chat, /reserve) - see PROGRESS.md -
 * this is the data-access layer that wiring will call into next.
 */
import { query } from "./pool.js";

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

/**
 * @param {object} params
 * @param {string|null} [params.travelerId] Anonymous client-generated UUID, or null.
 * @param {string} params.message
 * @param {string} params.destinationQuery
 * @param {string} params.checkIn YYYY-MM-DD
 * @param {string} params.checkOut YYYY-MM-DD
 * @param {object[]} params.rooms
 * @param {string} [params.currency]
 * @param {string} [params.routeStackCorrelationId]
 * @param {string} [params.routeStackToken]
 */
export async function createSession(params) {
  const {
    travelerId = null,
    message,
    destinationQuery,
    checkIn,
    checkOut,
    rooms,
    currency = "USD",
    routeStackCorrelationId = null,
    routeStackToken = null,
  } = params;

  const { rows } = await query(
    `INSERT INTO sessions
       (traveler_id, message, destination_query, check_in, check_out, rooms, currency,
        route_stack_correlation_id, route_stack_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      travelerId,
      message,
      destinationQuery,
      checkIn,
      checkOut,
      JSON.stringify(rooms),
      currency,
      routeStackCorrelationId,
      routeStackToken,
    ]
  );
  return rows[0];
}

export async function getSessionById(id) {
  const { rows } = await query("SELECT * FROM sessions WHERE id = $1", [id]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// reservations
// ---------------------------------------------------------------------------

/**
 * @param {object} params
 * @param {string} params.sessionId
 * @param {string} params.hotelId
 * @param {string} [params.hotelName]
 * @param {string} params.roomId
 * @param {string} params.recommendationId
 * @param {number} params.publishedRate
 * @param {string} [params.currency]
 * @param {string} params.checkIn
 * @param {string} params.checkOut
 * @param {string} [params.status] One of the status CHECK values in db/schema.sql.
 */
export async function createReservation(params) {
  const {
    sessionId,
    hotelId,
    hotelName = null,
    roomId,
    recommendationId,
    publishedRate,
    currency = "USD",
    checkIn,
    checkOut,
    status = "price_checked",
  } = params;

  const { rows } = await query(
    `INSERT INTO reservations
       (session_id, hotel_id, hotel_name, room_id, recommendation_id, published_rate,
        currency, check_in, check_out, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [sessionId, hotelId, hotelName, roomId, recommendationId, publishedRate, currency, checkIn, checkOut, status]
  );
  return rows[0];
}

/**
 * Moves a reservation to a new status, optionally recording the payment
 * URL and/or the RouteStack booking id as they become known. Only the
 * fields passed are updated - omit a field to leave it unchanged.
 * @param {string} id
 * @param {object} updates
 * @param {string} [updates.status]
 * @param {string} [updates.checkoutUrl]
 * @param {string} [updates.routeStackBookingId]
 */
export async function updateReservationStatus(id, updates) {
  const { status, checkoutUrl, routeStackBookingId } = updates;

  const { rows } = await query(
    `UPDATE reservations
     SET status = COALESCE($2, status),
         checkout_url = COALESCE($3, checkout_url),
         route_stack_booking_id = COALESCE($4, route_stack_booking_id),
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [id, status ?? null, checkoutUrl ?? null, routeStackBookingId ?? null]
  );
  return rows[0] ?? null;
}

export async function getReservationById(id) {
  const { rows } = await query("SELECT * FROM reservations WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listReservationsBySession(sessionId) {
  const { rows } = await query(
    "SELECT * FROM reservations WHERE session_id = $1 ORDER BY created_at DESC",
    [sessionId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// saved_preferences
// ---------------------------------------------------------------------------

/**
 * Creates or updates the one preferences row for a traveler_id.
 * @param {object} params
 * @param {string} params.travelerId
 * @param {string|null} [params.travelerType] One of preference-profiles.md's archetypes, or null.
 * @param {string[]} [params.preferredAmenities]
 * @param {string|null} [params.notes]
 */
export async function upsertPreferences(params) {
  const { travelerId, travelerType = null, preferredAmenities = [], notes = null } = params;

  const { rows } = await query(
    `INSERT INTO saved_preferences (traveler_id, traveler_type, preferred_amenities, notes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (traveler_id) DO UPDATE
       SET traveler_type = EXCLUDED.traveler_type,
           preferred_amenities = EXCLUDED.preferred_amenities,
           notes = EXCLUDED.notes,
           updated_at = now()
     RETURNING *`,
    [travelerId, travelerType, preferredAmenities, notes]
  );
  return rows[0];
}

export async function getPreferencesByTravelerId(travelerId) {
  const { rows } = await query("SELECT * FROM saved_preferences WHERE traveler_id = $1", [travelerId]);
  return rows[0] ?? null;
}
