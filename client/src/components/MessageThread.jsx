import HotelCard from "./HotelCard.jsx";
import { findSearchHotel } from "../hotelData.js";

/** One assistant turn's hotel cards - ranked if Recommend succeeded, in enrichTopHotels' plain order otherwise. */
function HotelCards({ data }) {
  const searchResult = data.search?.result ?? [];
  const enriched = data.enriched ?? [];
  if (enriched.length === 0) return null;

  const ranked = data.recommendation?.ranked;
  const entries = ranked?.length
    ? ranked
    : enriched.map((e, i) => ({ hotelId: e.hotelId, rank: i + 1, headline: null, tradeoff: null, caveats: [] }));

  return (
    <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
      {entries.map((entry) => {
        const enrichedHotel = enriched.find((e) => e.hotelId === entry.hotelId);
        if (!enrichedHotel) return null;
        return (
          <HotelCard
            key={entry.hotelId}
            rankEntry={entry}
            searchHotel={findSearchHotel(searchResult, entry.hotelId)}
            enrichedHotel={enrichedHotel}
            sessionId={data.sessionId}
          />
        );
      })}
    </div>
  );
}

function AssistantBubble({ data }) {
  const summary = data.recommendation?.summary;
  const noHotels = (data.enriched ?? []).length === 0;

  return (
    <div className="max-w-2xl rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
      {summary ? (
        <p>{summary}</p>
      ) : noHotels ? (
        <p>I didn't find any hotels matching that request - try naming a city or being more specific.</p>
      ) : (
        <p>
          Here's what I found{data.recommendationError ? " (I couldn't rank these automatically, so they're unranked)" : ""}:
        </p>
      )}
      <HotelCards data={data} />
    </div>
  );
}

export default function MessageThread({ messages }) {
  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-6">
      {messages.length === 0 && (
        <div className="m-auto max-w-md text-center text-sm text-slate-400">
          <p className="text-base font-medium text-slate-500">Where would you like to stay?</p>
          <p className="mt-1">
            Try: "a hotel in Dubai for 2 adults next weekend, we want free cancellation"
          </p>
        </div>
      )}

      {messages.map((m, i) => {
        if (m.role === "user") {
          return (
            <div key={i} className="ml-auto max-w-lg rounded-2xl rounded-tr-sm bg-stayora-navy px-4 py-3 text-sm text-white">
              {m.content}
            </div>
          );
        }

        if (m.pending) {
          return (
            <div key={i} className="flex max-w-2xl items-center gap-2 rounded-2xl rounded-tl-sm bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
              <span className="h-2 w-2 animate-pulse rounded-full bg-stayora-gold" />
              <span>Searching live availability and putting together a recommendation - this can take up to 30-40s...</span>
            </div>
          );
        }

        if (m.error) {
          return (
            <div key={i} className="max-w-2xl rounded-2xl rounded-tl-sm bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
              {m.error}
            </div>
          );
        }

        return <AssistantBubble key={i} data={m.data} />;
      })}
    </div>
  );
}
