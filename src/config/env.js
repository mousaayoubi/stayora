/**
 * Loads and validates environment configuration. Fails fast with a clear
 * message at startup rather than letting a missing key surface later as a
 * confusing 401 or "Cannot read properties of undefined" deep in a request.
 */
import "dotenv/config";

const REQUIRED = [
  "ANTHROPIC_API_KEY",
  "ROUTESTACK_BASE_URL",
  "ROUTESTACK_API_KEY",
  "ROUTESTACK_SECRET_KEY",
];

// dotenv only splits .env on "\n" - a file saved with Windows CRLF line
// endings (easy to end up with when editing on Windows) leaves a trailing
// "\r" stuck to every value. That's invisible in a terminal but breaks
// exact-match checks like RouteStack's apiKey lookup and HMAC signing, so
// every value is trimmed before use rather than trusting the raw parse.
function trimmed(key) {
  return process.env[key]?.trim();
}

const missing = REQUIRED.filter((key) => !trimmed(key));
if (missing.length > 0) {
  console.error(
    `Missing required environment variable(s): ${missing.join(", ")}.\n` +
      "Copy .env.example to .env and fill them in before starting the server."
  );
  process.exit(1);
}

export const env = {
  anthropicApiKey: trimmed("ANTHROPIC_API_KEY"),
  routeStackBaseUrl: trimmed("ROUTESTACK_BASE_URL").replace(/\/+$/, ""),
  routeStackApiKey: trimmed("ROUTESTACK_API_KEY"),
  routeStackSecretKey: trimmed("ROUTESTACK_SECRET_KEY"),
  port: Number(trimmed("PORT")) || 3000,
  // Not in REQUIRED: nothing in the live request path (/chat, /reserve)
  // depends on Postgres yet, so a missing DATABASE_URL shouldn't block the
  // whole server from starting. src/db/pool.js fails fast on its own the
  // moment something actually tries to use it.
  databaseUrl: trimmed("DATABASE_URL") || null,
};
