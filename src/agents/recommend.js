/**
 * Recommend agent: ranks the enriched shortlist and explains tradeoffs -
 * the pitch deck's core differentiator ("it doesn't stop at 'here are
 * options'"). Grounded in the RAG knowledge base (ranking-guide,
 * policy-explainers, preference-profiles) rather than Claude's own
 * unguided judgment, so the ranking rationale reflects Stayora's actual
 * ranking philosophy and not just generic travel-assistant instincts.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { retrieveTopChunks, buildContext } from "../rag/retrieve.js";

const MODEL = "claude-sonnet-5";

export class RecommendError extends Error {}

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

const RECOMMEND_TOOL = {
  name: "recommend_hotels",
  description:
    "Records a ranked recommendation across the shortlisted hotels, with an explained " +
    "tradeoff for each.",
  input_schema: {
    type: "object",
    properties: {
      ranked: {
        type: "array",
        items: {
          type: "object",
          properties: {
            hotelId: { type: "string" },
            rank: { type: "integer", minimum: 1 },
            headline: { type: "string", description: "One-line reason this hotel is ranked here." },
            tradeoff: {
              type: "string",
              description: "The specific tradeoff vs. at least one other shortlisted option, in plain language.",
            },
            caveats: {
              type: "array",
              items: { type: "string" },
              description:
                "Missing data or things worth flagging (no star rating, mandatory fees, a " +
                "fetch error) - empty array if none.",
            },
          },
          required: ["hotelId", "rank", "headline", "tradeoff"],
        },
      },
      summary: {
        type: "string",
        description: "A 1-3 sentence overall recommendation summary for the traveler.",
      },
    },
    required: ["ranked", "summary"],
  },
};

/**
 * Reduces one hotel's raw search-result fields + enrichment (rates/policy)
 * to the compact set of facts worth putting in front of the model - the
 * full get_rates payload is ~400KB and mostly irrelevant to a ranking
 * decision (room-by-room facility lists, provider IDs, etc.).
 */
function summarizeHotel(searchHotel, enrichedHotel) {
  if (enrichedHotel?.error) {
    return { hotelId: enrichedHotel.hotelId, name: enrichedHotel.name, error: enrichedHotel.error };
  }

  const rates = enrichedHotel?.rates;
  const rooms = (rates?.availability?.groups ?? []).flatMap((g) => g.rooms ?? []);
  const knowBeforeYouGo = enrichedHotel?.policy?.find((p) => /know_before_you_go/i.test(p.path))?.value;

  return {
    hotelId: enrichedHotel.hotelId,
    name: rates?.content?.name ?? searchHotel.name ?? enrichedHotel.name,
    starRating: rates?.content?.starRating ?? searchHotel.starRating ?? null,
    distanceKm: searchHotel.distancekm ?? null,
    ourpriceFrom: searchHotel.ourprice ?? null,
    publishedRate: searchHotel.publishedRate ?? null,
    savingratio: searchHotel.savingratio ?? null,
    freeCancellationAvailable: rates?.availability?.filters?.freeCancellation ?? null,
    payAtHotel: searchHotel.payAtHotel ?? null,
    roomOptionCount: rooms.length,
    anyRefundableRoomOption: rooms.some((r) => r.refundable === true),
    anyNonRefundableRoomOption: rooms.some((r) => r.refundable === false),
    mainAmenities: searchHotel.mainamenity ?? [],
    knowBeforeYouGo: knowBeforeYouGo ? cleanHtml(String(knowBeforeYouGo)).slice(0, 500) : null,
  };
}

function cleanHtml(text) {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * @param {string} message Original user message.
 * @param {object} intent Structured intent from understand().
 * @param {object[]} searchResults search_hotels' `result` array.
 * @param {object[]} enriched enrichTopHotels' output for the same shortlist.
 * @param {object} [options] { metrics }
 */
export async function recommend(message, intent, searchResults, enriched, options = {}) {
  if (!enriched?.length) {
    throw new RecommendError("No enriched hotels to recommend from.");
  }

  const hotels = enriched.map((e) =>
    summarizeHotel(searchResults.find((h) => h.id === e.hotelId) ?? {}, e)
  );

  const { chunks } = await retrieveTopChunks(
    `${message} ranking guide policy explainers preference profile`
  );
  const ragContext = buildContext(chunks);

  let response;
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1536,
      system:
        "You are Stayora's Recommend agent: rank the shortlisted hotels for this traveler and " +
        "explain the tradeoffs, grounded in the reference material below. Always name a " +
        "specific tradeoff between at least two of the shortlisted options - a ranking without " +
        "a named tradeoff is not useful. Never invent a star rating, price, or policy detail " +
        "not present in the hotel data below; if something is missing (e.g. starRating: null), " +
        "say so rather than guessing. If a hotel's entry has an `error` field, rank it last and " +
        "explain in its caveats that it couldn't be fully evaluated.\n\n" +
        `Reference material:\n${ragContext}`,
      tools: [RECOMMEND_TOOL],
      tool_choice: { type: "tool", name: "recommend_hotels" },
      messages: [
        {
          role: "user",
          content:
            `Traveler request: "${message}"\n` +
            `Stay: ${intent.checkIn} to ${intent.checkOut}, rooms: ${JSON.stringify(intent.rooms)}\n\n` +
            `Shortlisted hotels:\n${JSON.stringify(hotels, null, 2)}`,
        },
      ],
    });
  } catch (err) {
    throw new RecommendError(`Claude recommend call failed: ${err.message}`);
  } finally {
    if (options.metrics) options.metrics.modelCalls = (options.metrics.modelCalls || 0) + 1;
  }

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse) {
    throw new RecommendError("Claude did not return a structured recommendation.");
  }

  return toolUse.input;
}
