/**
 * Local Ollama embeddings client. Reasoning (Understand, Recommend) goes
 * through Claude - this is the one place the app talks to a local model,
 * scoped strictly to turning text into vectors for the RAG index. Ollama
 * has no bearing on tool-calling reliability here since embeddings aren't
 * agentic - that's why it's fine to use locally where Claude is used for
 * everything that reasons or calls tools.
 */
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";
const REQUEST_TIMEOUT_MS = 15000;

export class OllamaUnavailableError extends Error {}
export class EmbeddingError extends Error {}

/**
 * Requests an embedding vector for one piece of text. Retries once on
 * timeout/transport failure before giving up with a controlled error.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function embed(text) {
  try {
    return await embedOnce(text);
  } catch (err) {
    if (err instanceof EmbeddingError) throw err; // model-side error, retrying won't help
    return await embedOnce(text); // transport/timeout: retry exactly once
  }
}

async function embedOnce(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
      signal: controller.signal,
    });
  } catch (err) {
    throw new OllamaUnavailableError(
      `Could not reach Ollama at ${OLLAMA_HOST} for embeddings. Is "ollama serve" running and ` +
        `has "ollama pull ${EMBEDDING_MODEL}" been run? (${err.message})`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new EmbeddingError(`Ollama embeddings request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!Array.isArray(data.embedding)) {
    throw new EmbeddingError("Ollama response did not contain an embedding array.");
  }
  return data.embedding;
}

/**
 * Embeds many chunks sequentially, so a single local Ollama instance never
 * gets a burst of parallel requests.
 * @param {string[]} texts
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function embedMany(texts, onProgress) {
  const vectors = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(await embed(texts[i]));
    onProgress?.(i + 1, texts.length);
  }
  return vectors;
}
