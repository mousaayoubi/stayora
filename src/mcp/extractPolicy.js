/**
 * Best-effort policy extraction from a get-hotel-details-and-rates payload.
 *
 * RouteStack has no dedicated "get policy" endpoint - policy text (usually
 * cancellation terms) lives somewhere inside the hotel details/rates
 * response. This walks the object tree and collects every value reachable
 * under a policy-ish key name.
 *
 * Confirmed against a live payload (Day 1, Mena Aparthotel/Dubai): the
 * useful signals are per-room-rate `refundable` (boolean) / `refundability`
 * ("Refundable"/"NonRefundable") under `rooms.groups[].rooms[]`, and a
 * hotel-level `content.policies.know_before_you_go` string. Both are
 * covered generically below rather than hard-coded to that exact path, so
 * this keeps working if RouteStack nests things differently for another
 * hotel/provider.
 */
const POLICY_KEY_PATTERN = /polic|cancellation|refund/i;
const LEAF_TYPES = new Set(["string", "number", "boolean"]);
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
      if (!POLICY_KEY_PATTERN.test(key)) {
        walk(val, path, depth + 1, found);
        continue;
      }

      // A matched key with a leaf value (e.g. refundable: false) is the
      // signal itself. A matched key with a nested object/array (e.g.
      // policies: {know_before_you_go: "..."}) is collected as a whole
      // rather than only recursed into, so its own text isn't lost just
      // because its child key names don't happen to contain "policy".
      if (LEAF_TYPES.has(typeof val)) {
        found.push({ path, value: val });
      } else {
        found.push({ path, value: JSON.stringify(val).slice(0, 1000) });
      }
    }
  }
}
