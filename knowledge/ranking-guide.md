# Stayora Ranking Guide

## Philosophy

Stayora ranks hotels the way a good concierge would: fit to the traveler's actual trip, not
whichever result maximizes booking-fee margin or was paid to rank higher. A cheaper, worse-fit
hotel should never outrank a slightly pricier, better-fit one without saying so explicitly. The
whole point of the "agentic concierge" positioning is that the recommendation can be trusted -
that trust is lost the moment a ranking looks optimized for something other than the traveler.

## Ranking factors, in rough order of weight

1. **Fit to stated trip purpose and traveler type.** A business trip and a family vacation
   should not be ranked by the same criteria - see `preference-profiles.md` for what each
   traveler type actually cares about most.
2. **Cancellation flexibility relative to how far out the trip is.** A non-refundable rate is a
   real risk for a trip more than a few weeks out (plans change) and a reasonable bet for a trip
   in the next day or two. Weigh `refundable`/`refundability` against the gap between today and
   `checkIn`, not as a flat rule.
3. **Price**, specifically `ourprice` (what the traveler actually pays) against `publishedRate`
   and `saving`/`savingratio` when present - a real discount is worth surfacing, not just the
   raw price.
4. **Location fit.** `distance`/`distancekm` matters more when the traveler named a specific
   area, landmark, or purpose (e.g. "near the conference center") than for an open-ended "a
   hotel in Dubai" request.
5. **Relevant amenities.** Only weigh amenities/`facilities[]`/`options` that matter to the
   stated trip - free breakfast matters more for a family or budget trip than a single-night
   business stopover.
6. **Rating**, when available. `starRating` is frequently `null` in RouteStack's results - never
   invent or imply a rating that wasn't returned.

## How to explain tradeoffs

Always name the tradeoff explicitly, in plain language, comparing at least two of the shortlisted
options where it's informative: "X is $30/night cheaper but non-refundable, while Y is
refundable and includes breakfast - given your trip is three weeks out, Y's flexibility is
probably worth the difference." A recommendation without a named tradeoff is not a
recommendation, it's a listing - that's the gap Stayora exists to close (see the pitch deck's
"action friction" problem: most assistants can list options but don't help someone actually
decide).

## When data is incomplete

RouteStack's live data has real gaps - `starRating: null` is common, and not every hotel has a
`saving`/`savingratio`. State what's missing plainly ("rating not available for this one")
rather than guessing or omitting the caveat. A wrong guess is worse than an honest gap for a
tool whose entire value proposition is trust.
