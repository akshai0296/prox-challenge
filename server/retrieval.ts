import { readFileSync } from "node:fs";
import type { DocumentId } from "../src/types.js";

export type ManualPage = {
  document: DocumentId;
  documentTitle: string;
  sourceFile: string;
  page: number;
  text: string;
};

export type SearchResult = {
  document: DocumentId;
  documentTitle: string;
  page: number;
  score: number;
  excerpt: string;
  imagePath: string;
};

const pages = JSON.parse(
  readFileSync(new URL("../knowledge/manual-pages.json", import.meta.url), "utf8")
) as ManualPage[];

const synonyms: Record<string, string[]> = {
  ground: ["clamp", "workpiece", "polarity"],
  earth: ["ground", "clamp"],
  holes: ["porosity", "cavities", "burn-through"],
  bubbles: ["porosity", "cavities"],
  splatter: ["spatter"],
  gasless: ["flux-cored", "self-shielded", "dcen"],
  flux: ["flux-cored", "fcaw", "gasless"],
  mig: ["solid-core", "gas-shielded", "gmaw", "dcep"],
  tig: ["gtaw", "torch", "rod"],
  stick: ["smaw", "electrode", "holder"],
  feed: ["wire", "roller", "liner", "tensioner"],
  overheating: ["duty", "cycle", "thermal"],
  settings: ["chart", "material", "thickness", "amperage"],
  wont: ["does", "not", "fails"],
  outdoor: ["windy", "gasless", "flux-cored", "stick"]
};

const stop = new Set(["the","a","an","and","or","to","of","for","in","on","at","is","it","i","my","with","what","how","do","does","should","this","that"]);

function tokens(text: string): string[] {
  const base = text
    .toLowerCase()
    .replace(/([a-z])[-/ ]?cored/g, "$1-cored")
    .match(/[a-z0-9]+(?:-[a-z0-9]+)?/g) ?? [];
  const expanded = new Set<string>();
  for (const token of base) {
    if (!stop.has(token)) expanded.add(token);
    for (const related of synonyms[token] ?? []) expanded.add(related);
  }
  return [...expanded];
}

const documentTokens = pages.map(page => tokens(page.text));
const documentFrequency = new Map<string, number>();
for (const unique of documentTokens.map(list => new Set(list))) {
  for (const token of unique) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
}

function visualPath(document: DocumentId, page: number): string {
  if (document === "owner-manual") return `/manual/page-${page}.jpg`;
  if (document === "quick-start") return `/quick-start/page-${page}.jpg`;
  return "/reference/selection-chart.png";
}

function excerptFor(text: string, terms: string[]): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const lower = cleaned.toLowerCase();
  const positions = terms.map(term => lower.indexOf(term)).filter(index => index >= 0);
  const center = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, center - 180);
  const end = Math.min(cleaned.length, start + 620);
  return `${start > 0 ? "…" : ""}${cleaned.slice(start, end).trim()}${end < cleaned.length ? "…" : ""}`;
}

export function searchManual(
  query: string,
  options: { document?: DocumentId; limit?: number } = {}
): SearchResult[] {
  const queryTokens = tokens(query);
  const phrase = query.toLowerCase().trim();
  const results = pages
    .map((page, index) => {
      if (options.document && page.document !== options.document) return null;
      const termCounts = new Map<string, number>();
      for (const token of documentTokens[index]) termCounts.set(token, (termCounts.get(token) ?? 0) + 1);
      let score = 0;
      for (const term of queryTokens) {
        const frequency = termCounts.get(term) ?? 0;
        if (!frequency) continue;
        const idf = Math.log((pages.length + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
        score += (1 + Math.log(frequency)) * idf;
      }
      const pageLower = page.text.toLowerCase();
      if (phrase.length > 3 && pageLower.includes(phrase)) score += 12;
      if (queryTokens.length && queryTokens.every(term => pageLower.includes(term))) score += 4;
      if (!score) return null;
      return {
        document: page.document,
        documentTitle: page.documentTitle,
        page: page.page,
        score: Number(score.toFixed(3)),
        excerpt: excerptFor(page.text, queryTokens),
        imagePath: visualPath(page.document, page.page)
      } satisfies SearchResult;
    })
    .filter((result): result is SearchResult => Boolean(result))
    .sort((a, b) => b.score - a.score || a.page - b.page);
  return results.slice(0, Math.max(1, Math.min(options.limit ?? 5, 8)));
}

export function getManualPage(document: DocumentId, page: number): ManualPage | undefined {
  return pages.find(item => item.document === document && item.page === page);
}

export function getCorpusStats() {
  return {
    totalPages: pages.length,
    documents: {
      "owner-manual": pages.filter(page => page.document === "owner-manual").length,
      "quick-start": pages.filter(page => page.document === "quick-start").length,
      "selection-chart": pages.filter(page => page.document === "selection-chart").length
    }
  };
}
