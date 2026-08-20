import { useState } from "react";
import { reserveRoom, ApiError } from "../api.js";
import { hotelDisplay, cheapestRoom, anyRefundable, stripHtml } from "../hotelData.js";

/**
 * One ranked hotel: the Recommend agent's explanation plus an inline
 * confirm-before-book flow. Reserve is two real network round trips, not a
 * client-side checkbox in front of one call - see reserve.js on the
 * backend for why. `phase` here mirrors the backend's own phase names
 * (`revalidated` -> confirm -> `ready_for_payment`) so there's no
 * translation layer to get out of sync.
 */
export default function HotelCard({ rankEntry, searchHotel, enrichedHotel, sessionId }) {
  const [phase, setPhase] = useState("idle"); // idle | checking | revalidated | confirming | ready_for_payment | error
  const [reservationId, setReservationId] = useState(null);
  const [priceNow, setPriceNow] = useState(null);
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);

  if (enrichedHotel?.error) {
    return (
      <div className="w-72 shrink-0 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        <p className="font-medium text-slate-700">{rankEntry?.hotelId ?? "Unknown hotel"}</p>
        <p className="mt-1">Details unavailable: {enrichedHotel.error}</p>
      </div>
    );
  }

  const display = hotelDisplay(searchHotel, enrichedHotel);
  const room = cheapestRoom(enrichedHotel);
  const refundable = anyRefundable(enrichedHotel);

  async function checkPrice() {
    if (!room) return;
    setPhase("checking");
    setErrorMessage(null);
    try {
      const result = await reserveRoom({
        sessionId,
        hotelId: rankEntry.hotelId,
        hotelName: display.name,
        roomId: room.id,
        recommendationId: room.recommendationId,
        publishedRate: room.publishedRate,
      });
      setReservationId(result.reservationId);
      setPriceNow(result.revalidation?.ourprice ?? room.ourprice);
      setPhase("revalidated");
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  async function confirmAndPay() {
    if (!room) return;
    setPhase("confirming");
    setErrorMessage(null);
    try {
      const result = await reserveRoom({
        sessionId,
        reservationId,
        hotelId: rankEntry.hotelId,
        hotelName: display.name,
        roomId: room.id,
        recommendationId: room.recommendationId,
        publishedRate: room.publishedRate,
        confirm: true,
      });
      setCheckoutUrl(result.checkoutUrl);
      setPhase("ready_for_payment");
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : "Something went wrong.");
      setPhase("error");
    }
  }

  return (
    <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="relative h-36 w-full bg-slate-100">
        {display.heroImage ? (
          <img src={display.heroImage} alt={display.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">No image available</div>
        )}
        {rankEntry?.rank && (
          <span className="absolute left-2 top-2 rounded-full bg-stayora-navy px-2 py-0.5 text-xs font-semibold text-white">
            #{rankEntry.rank} pick
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{display.name}</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {display.starRating ? `${display.starRating}★` : "Rating not available"}
            {display.distanceKm != null ? ` · ${display.distanceKm.toFixed(1)} km away` : ""}
          </p>
        </div>

        {room && (
          <p className="text-lg font-semibold text-slate-900">
            ${room.ourprice.toFixed(2)}
            <span className="ml-1 text-xs font-normal text-slate-500">/ night, cheapest room</span>
          </p>
        )}

        <span
          className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
            refundable ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {refundable ? "A refundable option is available" : "No refundable option found"}
        </span>

        {rankEntry?.headline && <p className="text-xs text-slate-700">{rankEntry.headline}</p>}
        {rankEntry?.tradeoff && <p className="text-xs italic text-slate-500">{stripHtml(rankEntry.tradeoff)}</p>}

        {rankEntry?.caveats?.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
            {rankEntry.caveats.map((c, i) => (
              <li key={i}>· {c}</li>
            ))}
          </ul>
        )}

        <div className="mt-auto pt-2">
          {!room && <p className="text-xs text-slate-400">No bookable room found for this hotel.</p>}

          {room && phase === "idle" && (
            <button
              onClick={checkPrice}
              className="w-full rounded-lg bg-stayora-navy py-2 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Check price &amp; reserve
            </button>
          )}

          {phase === "checking" && (
            <button disabled className="w-full rounded-lg bg-slate-200 py-2 text-xs font-semibold text-slate-500">
              Checking current price...
            </button>
          )}

          {phase === "revalidated" && (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-600">
                Confirmed current price: <span className="font-semibold">${Number(priceNow).toFixed(2)}</span>
              </p>
              <button
                onClick={confirmAndPay}
                className="w-full rounded-lg bg-stayora-gold py-2 text-xs font-semibold text-stayora-navy hover:brightness-95"
              >
                Confirm &amp; get payment link
              </button>
            </div>
          )}

          {phase === "confirming" && (
            <button disabled className="w-full rounded-lg bg-slate-200 py-2 text-xs font-semibold text-slate-500">
              Getting payment link...
            </button>
          )}

          {phase === "ready_for_payment" && checkoutUrl && (
            <a
              href={checkoutUrl}
              target="_blank"
              rel="noreferrer"
              className="block w-full rounded-lg bg-emerald-600 py-2 text-center text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Complete payment (RouteStack) →
            </a>
          )}

          {phase === "error" && (
            <div className="space-y-1.5">
              <p className="text-xs text-red-600">{errorMessage}</p>
              <button
                onClick={checkPrice}
                className="w-full rounded-lg bg-slate-100 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
