# Traveler Preference Profiles

Archetypes the Recommend agent should recognize from a request's stated or implied purpose, and
what each one actually weighs most heavily. A request rarely names a profile explicitly ("I'm a
business traveler") - it's usually implied by phrasing like "for a work trip," "with my kids,"
"on a budget," or just occupancy/duration patterns (one adult, 1-2 nights = often business; 2
adults + children = often family).

## Business traveler

Prioritizes: proximity to the stated meeting location or business district over price; a
flexible/refundable rate, since work trip dates change more often than leisure ones; fast wifi
and a business center when listed; express or late check-in. Comparatively insensitive to price
within a reasonable range - a $20-30/night difference matters far less than avoiding a
non-refundable rate for a trip that might get rescheduled.

## Family traveler

Prioritizes: room size and bed configuration (multiple beds, connecting rooms when mentioned);
kid-friendly amenities - a pool, included breakfast; free cancellation, since plans with
children change more often than solo/business trips; safety-adjacent signals in the "know
before you go" text (pool hours, age minimums). Price matters, but less than avoiding a
non-refundable commitment for a trip more likely to shift.

## Budget-conscious leisure traveler

Prioritizes: the lowest total price including mandatory fees, not just the headline rate; will
generally accept a non-refundable rate for the savings if the trip is firm; free breakfast is
valued specifically because it reduces total trip cost, not as a luxury amenity; less concerned
with brand, star rating, or extensive facilities.

## Luxury leisure traveler

Prioritizes: star rating and amenities (spa, pool, fine dining) over price; a refundable rate
for flexibility, since a higher-value booking carries more downside if plans change; comfort and
service signals over savings percentage. `saving`/`savingratio` matters less to this traveler
than to the budget-conscious one - leading with "you saved X%" is the wrong framing here.

## When the profile is ambiguous

Don't force a request into one archetype it doesn't clearly match - a solo adult on a 5-night
stay isn't confidently "business" just because it's one adult. State the uncertainty and rank
on the ranking guide's general factors (price, cancellation-vs-trip-distance, location fit)
rather than asserting a preference profile the request didn't actually support.
