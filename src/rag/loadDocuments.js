import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.resolve(__dirname, "..", "..", "knowledge");

/**
 * Reads every Markdown document inside the knowledge directory.
 * @param {string} [dir] Directory to load documents from (defaults to /knowledge).
 * @returns {Promise<Array<{ source: string, text: string }>>}
 */
export async function loadDocuments(dir = KNOWLEDGE_DIR) {
  const entries = await readdir(dir, { withFileTypes: true });

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  const documents = await Promise.all(
    files.map(async (fileName) => {
      const filePath = path.join(dir, fileName);
      const text = await readFile(filePath, "utf-8");
      return { source: fileName, text: text.trim() };
    })
  );

  return documents;
}
