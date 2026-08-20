/**
 * Best-effort policy extraction from a get-hotel-details-and-rates payload.
 *
 * RouteStack has no dedicated "get policy" endpoint - policy text (usually
 * cancellation terms) lives somewhere inside the hotel details/rates
 * response. Their docs mark that response body as "too large to include in
 * docs examples," so the exact field names are unverified. Rather than
 * hard-code a guess that silently returns nothing on a live payload, this
 * walks the object tree and collects every value reachable under a
 * policy-ish key name.
 *
 * TODO once we see a live response: replace this with direct field access
 * (e.g. `result.rooms[].cancellationPolicy`) for accuracy and speed.
 */
const POLICY_KEY_PATTERN = /polic|cancellation|refundable/i;
const MAX_DEPTH = 6;

export function extractPolicySnippets(payload) {
  const found = [];
  walk(payload, "", 0, found);
  return found;
}

function walk(value, keyPath, depth, found) {
  if (value == null || depth > MAX_DEPTH || found.length >= 50) return;

  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, `${keyPath}[${i}]`, depth + 1, found));
    return;
  }

  if (typeof value === "object") {
    for (const [key, val] of Object.entries(value)) {
      const path = keyPath ? `${keyPath}.${key}` : key;
      if (POLICY_KEY_PATTERN.test(key) && (typeof val === "string" || typeof val === "number")) {
        found.push({ path, value: val });
      } else {
        walk(val, path, depth + 1, found);
      }
    }
  }
}
