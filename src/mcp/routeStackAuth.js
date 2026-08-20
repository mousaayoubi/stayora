/**
 * RouteStack partner token auth.
 *
 * POST /mcp/auth/partner-token exchanges partner credentials for a
 * short-lived (24h) bearer JWT that every other /mcp/* call needs as
 * `Authorization: Bearer <token>`.
 *
 * Request shape per RouteStack's "How To Use Your Keys" guide:
 *   { apiKey, timestamp (unix seconds), nonce, hmac }
 * where hmac is HMAC-SHA256 of "apiKey:timestamp:nonce" using the partner
 * secret key, base64url-encoded (not hex - confirmed against RouteStack's
 * own Node.js sample, which does `.digest('base64url')`).
 */
import crypto from "node:crypto";
import { env } from "../config/env.js";

export class RouteStackAuthError extends Error {}

let cachedToken = null; // { token, expiresAt }

function signRequest() {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const hmac = crypto
    .createHmac("sha256", env.routeStackSecretKey)
    .update(`${env.routeStackApiKey}:${timestamp}:${nonce}`)
    .digest("base64url");

  return { apiKey: env.routeStackApiKey, timestamp, nonce, hmac };
}

/** Parses RouteStack's `expiresIn` ("24h") into milliseconds. Defaults to 1h if unparseable, so a bad value degrades to over-fetching tokens rather than caching a stale one. */
function parseExpiresIn(expiresIn) {
  const match = /^(\d+)([smhd])$/.exec(String(expiresIn ?? "").trim());
  if (!match) return 60 * 60 * 1000;
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return value * unitMs[match[2]];
}

async function fetchToken() {
  const response = await fetch(`${env.routeStackBaseUrl}/mcp/auth/partner-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signRequest()),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.token) {
    throw new RouteStackAuthError(
      `RouteStack partner-token request failed (${response.status}): ${
        body?.message ?? "no body"
      }`
    );
  }

  return body;
}

/**
 * Returns a valid bearer token, reusing the cached one until shortly before
 * it expires. `force` bypasses the cache - used to recover from a 401 that
 * suggests the cached token was revoked early.
 */
export async function getPartnerToken({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedToken && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  const { token, expiresIn } = await fetchToken();
  // Refresh 5 minutes early so an in-flight request never races expiry.
  cachedToken = { token, expiresAt: now + parseExpiresIn(expiresIn) - 5 * 60 * 1000 };
  return token;
}
