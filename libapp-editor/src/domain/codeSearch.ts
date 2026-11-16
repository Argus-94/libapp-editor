/**
 * Single entry for "string/anchor → code candidates in .text"
 * Used by Analyze, Results, Wizard — no duplicate logic in screens.
 */
import { scanCodeCandidates, CodeCandidate, TextRange, defaultTextRange } from "../utils/onDeviceRe";
import { AnalyzeReport } from "../utils/analyze";

export type CodeSearchInput = {
  buffer: Uint8Array;
  strings: { key: string; offset: number }[];
  textRange?: TextRange | null;
};

export type CodeSearchResult = {
  candidates: CodeCandidate[];
  /** high confidence: score >= 55 and has patchHex */
  actionable: CodeCandidate[];
  /** weak near_imm_ret without string link */
  weak: CodeCandidate[];
};

export function runCodeSearch(input: CodeSearchInput): CodeSearchResult {
  const textRange = input.textRange || defaultTextRange(input.buffer.length);
  const candidates = scanCodeCandidates({
    buffer: input.buffer,
    textRange,
    strings: input.strings,
  });
  // Honesty filter: demote pure near_imm_ret without string
  const ranked = candidates.map((c) => {
    if (c.kind === "near_imm_ret" && !c.stringKey) {
      return { ...c, score: Math.min(c.score, 30) };
    }
    return c;
  });
  ranked.sort((a, b) => b.score - a.score || a.offset - b.offset);
  const actionable = ranked.filter((c) => c.score >= 55 && !!c.patchHex);
  const weak = ranked.filter((c) => c.score < 55);
  return { candidates: ranked, actionable, weak };
}

export function stringsFromReport(report: AnalyzeReport): { key: string; offset: number }[] {
  return report.getterNames.map((g) => ({ key: g.key, offset: g.offset }));
}
