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

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `Missing required environment variable(s): ${missing.join(", ")}.\n` +
      "Copy .env.example to .env and fill them in before starting the server."
  );
  process.exit(1);
}

export const env = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  routeStackBaseUrl: process.env.ROUTESTACK_BASE_URL.replace(/\/+$/, ""),
  routeStackApiKey: process.env.ROUTESTACK_API_KEY,
  routeStackSecretKey: process.env.ROUTESTACK_SECRET_KEY,
  port: Number(process.env.PORT) || 3000,
};
