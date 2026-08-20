/**
 * Thin fetch wrappers over the Express API. Every call already returns a
 * typed error shape from the backend (`{ok:false, error, code}`) - these
 * just throw an Error carrying that same message/code so components can
 * catch one thing regardless of which endpoint failed.
 */
export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new ApiError(data?.error ?? `Request to ${path} failed.`, data?.code ?? "UNKNOWN", response.status);
  }

  return data;
}

/** @param {string} message @param {string} [travelerId] */
export function sendChat(message, travelerId) {
  return post("/chat", { message, travelerId });
}

/** @param {object} params See server.js's POST /reserve for the full field list. */
export function reserveRoom(params) {
  return post("/reserve", params);
}

const TRAVELER_ID_KEY = "stayora.travelerId";

/**
 * A bare anonymous identifier, not an account - generated once per browser
 * and reused across sessions so /chat's optional travelerId groups a
 * returning visitor's sessions together. No login, no personal data.
 */
export function getTravelerId() {
  let id = localStorage.getItem(TRAVELER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(TRAVELER_ID_KEY, id);
  }
  return id;
}
