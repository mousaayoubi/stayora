import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadDocuments } from "./loadDocuments.js";
import { chunkDocuments } from "./chunk.js";
import { embedMany } from "./ollamaEmbeddings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const VECTORS_PATH = path.join(DATA_DIR, "vectors.json");

/**
 * Indexing pipeline: Load -> Chunk -> Embed -> Store.
 * Run once (or whenever knowledge/ changes) via `npm run index`.
 */
async function main() {
  console.log("Loading documents from knowledge/ ...");
  const documents = await loadDocuments();
  console.log(`  Loaded ${documents.length} document(s): ${documents.map((d) => d.source).join(", ")}`);

  console.log("Chunking documents ...");
  const chunks = chunkDocuments(documents, { chunkSize: 160, overlap: 30 });
  console.log(`  Produced ${chunks.length} chunk(s).`);

  console.log("Generating embeddings with Ollama (this may take a moment) ...");
  const vectors = await embedMany(
    chunks.map((c) => c.text),
    (done, total) => process.stdout.write(`\r  Embedded ${done}/${total} chunks`)
  );
  process.stdout.write("\n");

  const indexed = chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] }));

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(VECTORS_PATH, JSON.stringify(indexed, null, 2), "utf-8");

  console.log(`Saved vector index to ${path.relative(process.cwd(), VECTORS_PATH)}`);
}

main().catch((err) => {
  console.error("Indexing failed:", err.message);
  process.exit(1);
});
