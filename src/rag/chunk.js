/**
 * Splits a document's text into overlapping, word-bounded, section-aware
 * chunks. Chunking is word-based (not character-based) so chunk boundaries
 * never cut a word in half. Each chunk records its Markdown section as
 * `section` - a chunk never spans two different headings, so that label is
 * always accurate to the chunk's actual content (a chunk can still split a
 * long section across multiple chunks, just never merge two sections into
 * one chunk). A doc with short, densely-headed sections (shorter than
 * `chunkSize`) naturally produces one chunk per section instead of the
 * window straddling a heading and mislabeling most of its own text.
 *
 * @param {{ source: string, text: string }} document
 * @param {object} [options]
 * @param {number} [options.chunkSize=160] Target words per chunk.
 * @param {number} [options.overlap=30] Words repeated between consecutive chunks.
 * @returns {Array<{ id: string, source: string, section: string, chunkIndex: number, text: string }>}
 */
export function chunkDocument(document, options = {}) {
  const { chunkSize = 160, overlap = 30 } = options;
  const { source, text } = document;

  const chunks = [];
  let chunkIndex = 0;

  for (const { section, words } of sectionedWordGroups(text)) {
    let start = 0;

    while (start < words.length) {
      const end = Math.min(start + chunkSize, words.length);
      const chunkText = words.slice(start, end).join(" ").trim();

      if (chunkText.length > 0) {
        chunks.push({
          id: `${slugify(source)}-${String(chunkIndex).padStart(2, "0")}`,
          source,
          section,
          chunkIndex,
          text: chunkText,
        });
        chunkIndex += 1;
      }

      if (end === words.length) break;
      start = end - overlap; // step forward, re-including the overlap window
    }
  }

  return chunks;
}

/** Chunks every document in a collection. */
export function chunkDocuments(documents, options = {}) {
  return documents.flatMap((doc) => chunkDocument(doc, options));
}

/**
 * Splits text into consecutive runs of words that share the same Markdown
 * heading ("## Section Name"), so each run's words all genuinely belong to
 * that section.
 * @returns {Array<{ section: string, words: string[] }>}
 */
function sectionedWordGroups(text) {
  const lines = text.split("\n");
  const groups = [];
  let currentSection = "General";
  let currentWords = [];

  const flush = () => {
    if (currentWords.length > 0) groups.push({ section: currentSection, words: currentWords });
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      flush();
      currentSection = heading[1].trim();
      currentWords = [];
      continue;
    }
    currentWords.push(...line.split(/\s+/).filter(Boolean));
  }
  flush();

  return groups;
}

function slugify(fileName) {
  return fileName.replace(/\.[^/.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
