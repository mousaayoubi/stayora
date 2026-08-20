/**
 * Structured JSONL logging. Every request appends exactly one line to
 * data/logs.jsonl - easy to grep, tail, or load into an evaluation harness
 * (Day 3) without a database.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const LOG_PATH = path.join(DATA_DIR, "logs.jsonl");

let requestCounter = 0;

/** Generates a short, readable, unique-enough request id. */
export function newRequestId() {
  requestCounter += 1;
  return `req-${Date.now().toString(36)}-${requestCounter}`;
}

/**
 * Appends one structured log record. Never throws into the request path -
 * a logging failure should not fail the user's request.
 * @param {object} entry
 */
export async function logRequest(entry) {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await appendFile(LOG_PATH, JSON.stringify(entry) + "\n", "utf-8");
  } catch (err) {
    console.error("Failed to write log entry:", err.message);
  }
}

export { LOG_PATH };
