# Hotel Policy Explainers

Plain-language explanations of the policy terms RouteStack returns, so the Recommend agent can
translate raw fields into something a traveler actually understands - this is the "trust gap"
half of Stayora's differentiator: prices and policies that are clear before checkout, not
discovered after.

## Refundable vs. non-refundable

`refundable: true` / `refundability: "Refundable"` means the traveler can cancel (usually up to
some deadline shown elsewhere in the rate details, when RouteStack provides one) and get their
money back. `refundable: false` / `refundability: "NonRefundable"` means the booking is locked
in the moment it's paid for - no refund for a change of plans. Non-refundable rates are
typically 5-15% cheaper than the refundable rate for the same room, which is the real tradeoff
to name: cheaper now vs. protected against a changed plan.

## Free cancellation

`freeCancellation: true` (seen at the search-result level, under `filters`, or per-room) means
at least one rate option for that hotel can be cancelled without a fee before some deadline.
This is not the same as every rate for that hotel being refundable - always check the specific
room/rate's own `refundable` flag, not just the hotel-level flag, before telling a traveler a
particular price is cancel-friendly.

## Pay at hotel vs. pay now

`payAtHotel: true` means the traveler reserves now and pays at check-in rather than at booking
time - useful for a traveler who wants to avoid a charge landing before the trip, or who isn't
fully certain yet. `ratetype: "POSTPAID"` reflects the same idea from the rate's side. This is a
different axis from refundable/non-refundable - a rate can be pay-at-hotel and still
non-refundable (a no-show fee or the full rate may still be charged).

## "Know before you go" / mandatory fees

Hotel-level `policies`/`know_before_you_go` text (property rules: ID requirements, age
minimums, pet policy, quiet hours, etc.) and `fees.mandatory` (resort fees, city/tourism taxes
charged at the property, not included in the quoted price) are both easy to miss and genuinely
change the real cost or feasibility of a stay. When either is present in the retrieved hotel
data, it's worth surfacing proactively rather than waiting for the traveler to ask - that is
exactly the "trust gap" problem this product is meant to close.

## Deposits and ID/credit-card holds

Some properties require a credit card, ID, or deposit at check-in for incidentals even on an
otherwise prepaid, refundable booking. This shows up in free-text `checkin.instructions` rather
than a structured field - flag it when it's present in the retrieved content, since it can be a
real surprise for a traveler expecting a fully "paid" stay.
