/**
 * Reads through /chat's response shapes (search.result[] + enriched[]) to
 * get the handful of fields a card needs to render, and picks the room a
 * "Reserve" click actually books. Centralized here so HotelCard doesn't
 * need to know RouteStack's nested field names directly.
 */

/** Finds the raw search_hotels entry matching one enriched hotel. */
export function findSearchHotel(searchResult, hotelId) {
  return (searchResult ?? []).find((h) => h.id === hotelId) ?? {};
}

/** Flattens every room option across an enriched hotel's rate groups. */
export function listRooms(enrichedHotel) {
  return (enrichedHotel?.rates?.availability?.groups ?? []).flatMap((g) => g.rooms ?? []);
}

/**
 * Picks the room a card's "Reserve" button books - the lowest-priced
 * option. This is a deliberate MVP simplification (no room-picker UI yet):
 * clearly labeled in the card as "from $X - cheapest available room" so
 * the traveler knows what they're confirming, not left to guess.
 */
export function cheapestRoom(enrichedHotel) {
  const rooms = listRooms(enrichedHotel);
  if (rooms.length === 0) return null;
  return rooms.reduce((min, r) => (r.ourprice < min.ourprice ? r : min), rooms[0]);
}

/** Display fields for one card, merging the search result with enrichment. */
export function hotelDisplay(searchHotel, enrichedHotel) {
  const content = enrichedHotel?.rates?.content;
  return {
    name: content?.name ?? searchHotel.name ?? enrichedHotel?.name ?? "Unnamed hotel",
    heroImage: searchHotel.heroImage ?? content?.heroImage ?? null,
    starRating: content?.starRating ?? searchHotel.starRating ?? null,
    distanceKm: searchHotel.distancekm ?? null,
    mainAmenities: searchHotel.mainamenity ?? [],
  };
}

/** True if any room option for this hotel is refundable - for a quick badge. */
export function anyRefundable(enrichedHotel) {
  return listRooms(enrichedHotel).some((r) => r.refundable === true);
}

const HTML_TAG = /<[^>]+>/g;

/** Strips HTML from RouteStack's free-text fields (descriptions, policy text). */
export function stripHtml(text) {
  return typeof text === "string" ? text.replace(HTML_TAG, " ").replace(/\s+/g, " ").trim() : "";
}
