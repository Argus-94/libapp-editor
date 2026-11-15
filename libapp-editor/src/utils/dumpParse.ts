/**
 * Offline dump / Blutter-ish text parser.
 * Does NOT run Blutter — only consumes exported text from PC tools.
 */

import { findAll } from "./binary";
import { FEATURE_DEFS, FeatureCategory } from "./premiumFeatures";
import { parseOffsetList, ImportedOffset } from "./offsetImport";

export interface DumpSymbol {
  name: string;
  offset: number | null;
  hexOffset: string | null;
  category: FeatureCategory | "symbol" | "string";
  weight: number;
  line: string;
}

export interface DumpParseResult {
  symbols: DumpSymbol[];
  offsets: ImportedOffset[];
  matchedInSo: {
    name: string;
    soOffset: number;
    hexOffset: string;
    category: string;
    weight: number;
  }[];
  stats: {
    lines: number;
    symbolHits: number;
    offsetHits: number;
    soMatches: number;
  };
  notes: string[];
}

const NAME_PATTERNS: { re: RegExp; weight: number }[] = [
  { re: /\bget:ownsPro\b/g, weight: 100 },
  { re: /\bownsPro\b/g, weight: 95 },
  { re: /\bget:isPro\b/g, weight: 98 },
  { re: /\bisPro\b/g, weight: 90 },
  { re: /\bget:servingAdsNow\b/g, weight: 85 },
  { re: /\bisPremium\b/g, weight: 88 },
  { re: /\bisSubscribed\b/g, weight: 86 },
  { re: /\bqueryPastPurchases\b/g, weight: 74 },
  { re: /\bpurchaseStream\b/g, weight: 70 },
  { re: /\bproRequired\b/g, weight: 88 },
  { re: /\bpaywall\b/gi, weight: 70 },
];

function catForName(name: string): { category: FeatureCategory | "symbol" | "string"; weight: number } {
  for (const d of FEATURE_DEFS) {
    if (name === d.key || name.includes(d.key)) {
      return { category: d.category, weight: d.weight };
    }
  }
  return { category: "symbol", weight: 40 };
}

/**
 * Parse exported Blutter / strings / r2 notes text.
 * If `so` is provided, also locate same string keys inside the binary.
 */
export function parseOfflineDump(text: string, so?: Uint8Array | null): DumpParseResult {
  const lines = text.split(/\r?\n/);
  const symbols: DumpSymbol[] = [];
  const notes: string[] = [];
  const seenName = new Set<string>();

  for (const line0 of lines) {
    const line = line0.trim();
    if (!line) continue;

    // Blutter-like: [pp+0x..] "name"  or Function 'name'
    const pp = line.match(/\[pp\+0x([0-9a-fA-F]+)\]\s*:?\s*"([^"]+)"/i);
    if (pp) {
      const name = pp[2];
      const { category, weight } = catForName(name);
      if (!seenName.has(name + pp[1])) {
        seenName.add(name + pp[1]);
        symbols.push({
          name,
          offset: parseInt(pp[1], 16),
          hexOffset: "0x" + pp[1].toUpperCase(),
          category,
          weight,
          line: line.slice(0, 120),
        });
      }
      continue;
    }

    const fn = line.match(/Function\s+'([^']+)'/i) || line.match(/Function\s+\"([^\"]+)\"/i);
    if (fn) {
      const name = fn[1];
      const { category, weight } = catForName(name);
      symbols.push({
        name,
        offset: null,
        hexOffset: null,
        category,
        weight,
        line: line.slice(0, 120),
      });
      continue;
    }

    for (const { re, weight } of NAME_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        const name = m[0];
        const offM = line.match(/0x([0-9a-fA-F]{4,12})/);
        const off = offM ? parseInt(offM[1], 16) : null;
        const key = name + ":" + (off ?? "x");
        if (seenName.has(key)) continue;
        seenName.add(key);
        const { category } = catForName(name);
        symbols.push({
          name,
          offset: off,
          hexOffset: off !== null ? "0x" + off.toString(16).toUpperCase().padStart(8, "0") : null,
          category,
          weight,
          line: line.slice(0, 120),
        });
      }
    }
  }

  const offsets = parseOffsetList(text);

  const matchedInSo: DumpParseResult["matchedInSo"] = [];
  if (so && so.length > 0) {
    const enc = new TextEncoder();
    const names = new Set<string>();
    for (const s of symbols) names.add(s.name);
    for (const d of FEATURE_DEFS.slice(0, 40)) names.add(d.key);
    for (const name of names) {
      if (name.length < 4) continue;
      try {
        const pat = enc.encode(name);
        const offs = findAll(so, pat, 8);
        for (const soOffset of offs) {
          const { category, weight } = catForName(name);
          matchedInSo.push({
            name,
            soOffset,
            hexOffset: "0x" + soOffset.toString(16).toUpperCase().padStart(8, "0"),
            category,
            weight,
          });
        }
      } catch {
        /* skip */
      }
    }
    matchedInSo.sort((a, b) => b.weight - a.weight || a.soOffset - b.soOffset);
  }

  if (!text.trim()) notes.push("Пустой файл дампа");
  if (symbols.length === 0 && offsets.length === 0) {
    notes.push("Не найдено символов/offset — проверь формат (Blutter text, r2, список 0x…)");
  }
  if (so && matchedInSo.length === 0) {
    notes.push("В открытом libapp.so строки из дампа не совпали (другой бинарь или обфускация)");
  }

  return {
    symbols: symbols.sort((a, b) => b.weight - a.weight),
    offsets,
    matchedInSo: matchedInSo.slice(0, 80),
    stats: {
      lines: lines.length,
      symbolHits: symbols.length,
      offsetHits: offsets.length,
      soMatches: matchedInSo.length,
    },
    notes,
  };
}
