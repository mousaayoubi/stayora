/**
 * Understand step: turns a plain-English hotel request into the structured
 * intent search_hotels needs (destination, check-in/out dates, room
 * occupancy). Uses a forced Claude tool call rather than free-form JSON
 * parsing, so the result is schema-valid by construction instead of by
 * hoping the model didn't wrap it in prose or markdown fences.
 */
import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";

const MODEL = "claude-sonnet-5";

export class UnderstandError extends Error {}

const anthropic = new Anthropic({ apiKey: env.anthropicApiKey });

const EXTRACT_STAY_INTENT_TOOL = {
  name: "extract_stay_intent",
  description: "Records the structured hotel search intent extracted from the user's message.",
  input_schema: {
    type: "object",
    properties: {
      destinationQuery: {
        type: "string",
        description: "The city, area, or named property the user wants to stay at.",
      },
      checkIn: { type: "string", description: "Check-in date, YYYY-MM-DD." },
      checkOut: { type: "string", description: "Check-out date, YYYY-MM-DD." },
      rooms: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            adults: { type: "integer", minimum: 1 },
            children: { type: "integer", minimum: 0 },
          },
          required: ["adults"],
        },
      },
      currency: { type: "string", description: "ISO 4217 currency code, default USD." },
      missingInfo: {
        type: "array",
        items: { type: "string" },
        description:
          "Anything required (destination, dates, occupancy) that the user's message didn't " +
          "specify and had to be assumed or defaulted - empty array if nothing was assumed.",
      },
    },
    required: ["destinationQuery", "checkIn", "checkOut", "rooms"],
  },
};

/**
 * @param {string} message Raw user message.
 * @returns {Promise<{destinationQuery: string, checkIn: string, checkOut: string, rooms: object[], currency: string, missingInfo: string[]}>}
 */
export async function understand(message) {
  if (typeof message !== "string" || !message.trim()) {
    throw new UnderstandError("A non-empty message is required.");
  }

  const today = new Date().toISOString().slice(0, 10);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system:
      `Today's date is ${today}. Extract hotel search intent from the user's message and call ` +
      "extract_stay_intent with it. Resolve relative dates (e.g. 'next weekend', 'in October') " +
      "against today's date. If room occupancy isn't mentioned, assume one room for two adults " +
      "and list that assumption in missingInfo. If checkOut isn't mentioned, assume a 2-night " +
      "stay starting at checkIn and list that assumption too.",
    tools: [EXTRACT_STAY_INTENT_TOOL],
    tool_choice: { type: "tool", name: "extract_stay_intent" },
    messages: [{ role: "user", content: message }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse) {
    throw new UnderstandError("Claude did not return a structured intent.");
  }

  const intent = toolUse.input;
  return {
    destinationQuery: intent.destinationQuery,
    checkIn: intent.checkIn,
    checkOut: intent.checkOut,
    rooms: (intent.rooms ?? []).map((r) => ({ adults: r.adults, children: r.children ?? 0 })),
    currency: intent.currency || "USD",
    missingInfo: intent.missingInfo ?? [],
  };
}
