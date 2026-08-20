import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { embed } from "./ollamaEmbeddings.js";
import { cosineSimilarity } from "./similarity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VECTORS_PATH = path.resolve(__dirname, "..", "..", "data", "vectors.json");

// Not pulled from a shared guardrails module (that's Day 3 scope) - these
// are reasonable defaults for a knowledge base this small (3 documents).
const DEFAULT_TOP_K = 4;
const MIN_RELEVANCE_SCORE = 0.55;

let cachedIndex = null;

/** Loads the local vector store (data/vectors.json), caching it in memory. */
export async function loadVectorIndex() {
  if (cachedIndex) return cachedIndex;

  let raw;
  try {
    raw = await readFile(VECTORS_PATH, "utf-8");
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`No vector index found at data/vectors.json. Run "npm run index" first to build it.`);
    }
    throw err;
  }

  cachedIndex = JSON.parse(raw);
  return cachedIndex;
}

/** Clears the in-memory index cache (useful after re-indexing). */
export function clearIndexCache() {
  cachedIndex = null;
}

/**
 * Embeds a query and scores it against every chunk in the vector store
 * using cosine similarity, returning results sorted best-first.
 * @param {string} query
 */
export async function semanticSearch(query) {
  const index = await loadVectorIndex();
  const queryEmbedding = await embed(query);

  const scored = index.map((chunk) => ({
    id: chunk.id,
    source: chunk.source,
    section: chunk.section,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Plain keyword/substring fallback search, used when semantic search either
 * fails (e.g. Ollama unavailable) or returns nothing above the relevance
 * threshold. Scores chunks by how many query words they contain.
 * @param {string} query
 */
export async function keywordSearch(query) {
  const index = await loadVectorIndex();
  const words = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);

  const scored = index.map((chunk) => {
    const lowerText = chunk.text.toLowerCase();
    const hits = words.filter((w) => lowerText.includes(w)).length;
    return { ...chunk, score: words.length ? hits / words.length : 0 };
  });

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Retrieves the top-K most relevant chunks for a query, falling back to
 * keyword search if semantic search errors out or the best semantic score
 * is below the relevance threshold. `usedFallback` tells the caller which
 * path was used, for logging.
 * @param {string} query
 * @param {object} [options] { k }
 */
export async function retrieveTopChunks(query, options = {}) {
  const { k = DEFAULT_TOP_K } = options;

  let scored;
  let usedFallback = false;
  try {
    scored = await semanticSearch(query);
    if ((scored[0]?.score ?? 0) < MIN_RELEVANCE_SCORE) {
      const keywordScored = await keywordSearch(query);
      if ((keywordScored[0]?.score ?? 0) > 0) {
        scored = keywordScored;
        usedFallback = true;
      }
    }
  } catch {
    scored = await keywordSearch(query);
    usedFallback = true;
  }

  return { chunks: scored.slice(0, k), usedFallback };
}

/**
 * Combines retrieved chunks into a single context block, grouped by source
 * so multiple chunks from the same file read as one section.
 * @param {Array<{ source: string, chunkIndex: number, text: string }>} chunks
 * @returns {string}
 */
export function buildContext(chunks) {
  const bySource = new Map();
  for (const chunk of chunks) {
    if (!bySource.has(chunk.source)) bySource.set(chunk.source, []);
    bySource.get(chunk.source).push(chunk);
  }

  return [...bySource.entries()]
    .map(([source, sourceChunks]) => {
      const ordered = [...sourceChunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
      const mergedText = mergeOverlappingTexts(ordered.map((c) => c.text));
      return `Source: ${source}\n\n${mergedText}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Joins a sequence of texts, collapsing the trailing/leading word overlap
 * between each consecutive pair instead of repeating it verbatim.
 */
function mergeOverlappingTexts(texts) {
  if (texts.length === 0) return "";

  let mergedWords = texts[0].split(/\s+/).filter(Boolean);

  for (let i = 1; i < texts.length; i++) {
    const nextWords = texts[i].split(/\s+/).filter(Boolean);
    const maxCheck = Math.min(mergedWords.length, nextWords.length);

    let overlapLen = 0;
    for (let k = maxCheck; k > 0; k--) {
      const tail = mergedWords.slice(-k).join(" ");
      const head = nextWords.slice(0, k).join(" ");
      if (tail === head) {
        overlapLen = k;
        break;
      }
    }

    mergedWords = mergedWords.concat(nextWords.slice(overlapLen));
  }

  return mergedWords.join(" ");
}
