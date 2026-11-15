/**
 * On-device RE assistant for Flutter libapp.so (AArch64)
 *
 * NOT Blutter / r2 / Ghidra — those are desktop tools.
 * This module approximates the useful part for Pro unlock:
 *   string (data) → likely code sites in .text → movz/ret candidates
 *
 * Techniques:
 *  1) ADRP+ADD xref scan toward string VA/offset
 *  2) literal pool / embedded offset hints
 *  3) near movz x0/w0 #0 + ret ranking
 */

import { bufferToHex, findAll, decodeArm64, disasmAround } from "./binary";

export interface TextRange {
  start: number;
  end: number;
}

export interface CodeCandidate {
  /** offset in file (.text) of suggested patch (usually movz) */
  offset: number;
  hexOffset: string;
  /** related PRO string */
  stringKey: string;
  stringOffset: number;
  /** why this site was chosen */
  reason: string;
  /** 0–100 */
  score: number;
  /** movz bytes at offset */
  movzHex: string;
  /** suggested patch (false→true) */
  patchHex: string;
  /** short disasm window */
  disasm: { offset: number; hex: string; asm: string; isCenter?: boolean }[];
  kind: "adrp_xref" | "near_imm_ret" | "near_string_window" | "pattern";
}

const MOVZ_X0_FALSE = hexToU32LE("000080D2");
const MOVZ_X0_TRUE = hexToU32LE("200080D2");
const MOVZ_W0_FALSE = hexToU32LE("00008052");
const MOVZ_W0_TRUE = hexToU32LE("20008052");
const RET = hexToU32LE("C0035FD6");

function hexToU32LE(hex: string): number {
  const c = hex.replace(/\s/g, "");
  return (
    parseInt(c.slice(0, 2), 16) |
    (parseInt(c.slice(2, 4), 16) << 8) |
    (parseInt(c.slice(4, 6), 16) << 16) |
    (parseInt(c.slice(6, 8), 16) << 24)
  ) >>> 0;
}

function readU32LE(buf: Uint8Array, off: number): number {
  if (off + 4 > buf.length) return 0;
  return (
    buf[off] |
    (buf[off + 1] << 8) |
    (buf[off + 2] << 16) |
    (buf[off + 3] << 24)
  ) >>> 0;
}

function isAligned4(n: number): boolean {
  return (n & 3) === 0;
}

/** Decode ADRP target page: returns page address or null */
function decodeAdrpPage(insn: number, pc: number): { rd: number; page: number } | null {
  // ADRP: op=1xxxx, bits [31]=1, [28:24]=10000
  if ((insn & 0x9f000000) !== 0x90000000) return null;
  const rd = insn & 0x1f;
  const immlo = (insn >> 29) & 0x3;
  const immhi = (insn >> 5) & 0x7ffff;
  let imm = (immhi << 2) | immlo;
  // sign-extend 21-bit
  if (imm & 0x100000) imm |= ~0x1fffff;
  const page = (pc & ~0xfff) + imm * 0x1000;
  return { rd, page: page >>> 0 };
}

/** Decode ADD Xd, Xn, #imm12 (64-bit, shift 0) */
function decodeAddImm12(insn: number): { rd: number; rn: number; imm: number } | null {
  // ADD (imm) 64-bit: 1001 0001 00xxxxxx...
  if ((insn & 0xffc00000) !== 0x91000000) return null;
  const rd = insn & 0x1f;
  const rn = (insn >> 5) & 0x1f;
  const imm = (insn >> 10) & 0xfff;
  return { rd, rn, imm };
}

export function defaultTextRange(fileSize: number): TextRange {
  // Flutter libapp.so often has RX load around 0x4c0000; fallback: upper 60%
  if (fileSize > 0x500000) {
    return { start: 0x4c0000, end: Math.min(fileSize, 0xc00000) };
  }
  return { start: Math.floor(fileSize * 0.25) & ~3, end: fileSize };
}

/**
 * Find ADRP+ADD sequences in text that materialize `targetOffset` into a register.
 * Returns code offsets of the ADRP instruction.
 */
export function findAdrpAddXrefs(
  buf: Uint8Array,
  targetOffset: number,
  text: TextRange,
  maxHits = 40
): number[] {
  const targetPage = targetOffset & ~0xfff;
  const targetOff = targetOffset & 0xfff;
  const hits: number[] = [];
  const start = Math.max(0, text.start) & ~3;
  const end = Math.min(buf.length - 8, text.end);

  for (let pc = start; pc < end; pc += 4) {
    const insn = readU32LE(buf, pc);
    const adrp = decodeAdrpPage(insn, pc);
    if (!adrp) continue;
    if (adrp.page !== targetPage) continue;

    // look ahead a few instructions for ADD with same rd as rn and imm=targetOff
    for (let k = 1; k <= 6; k++) {
      const pc2 = pc + k * 4;
      if (pc2 + 4 > buf.length) break;
      const add = decodeAddImm12(readU32LE(buf, pc2));
      if (!add) continue;
      if (add.rn === adrp.rd && add.imm === targetOff) {
        hits.push(pc);
        break;
      }
      // sometimes ADD uses rd of ADRP as rn even if rewritten
      if (add.imm === targetOff && (add.rn === adrp.rd || add.rd === adrp.rd)) {
        hits.push(pc);
        break;
      }
    }
    if (hits.length >= maxHits) break;
  }
  return hits;
}

/** Scan window for movz x0/w0 #0 that is followed by ret within maxGap bytes */
export function findMovzRetInWindow(
  buf: Uint8Array,
  from: number,
  to: number,
  maxGap = 16
): { offset: number; isX0: boolean }[] {
  const out: { offset: number; isX0: boolean }[] = [];
  const start = Math.max(0, from) & ~3;
  const end = Math.min(buf.length - 4, to);
  for (let off = start; off < end; off += 4) {
    const w = readU32LE(buf, off);
    const isX0 = w === MOVZ_X0_FALSE;
    const isW0 = w === MOVZ_W0_FALSE;
    if (!isX0 && !isW0) continue;
    // ret within maxGap
    let hasRet = false;
    for (let g = 4; g <= maxGap; g += 4) {
      if (off + g + 4 > buf.length) break;
      if (readU32LE(buf, off + g) === RET) {
        hasRet = true;
        break;
      }
    }
    if (hasRet) out.push({ offset: off, isX0 });
  }
  return out;
}

/** All imm_ret style sites in .text (movz false + ret within 4..12) */
export function findSafeImmRetSites(
  buf: Uint8Array,
  text: TextRange,
  max = 80
): { offset: number; isX0: boolean }[] {
  return findMovzRetInWindow(buf, text.start, text.end, 12).slice(0, max);
}

const PRIORITY_KEYS = [
  "get:ownsPro",
  "ownsPro",
  "get:isPro",
  "isPro",
  "isPremium",
  "get:voicePro",
  "hasPremium",
  "proUser",
  "isUnlocked",
  "isSubscribed",
];


/** ARM64: decode movz Rd, #imm (W or X) */
function decodeMovzImm(insn: number): { rd: number; imm: number; is64: boolean } | null {
  // MOVZ 64: 1 10 1001 01 ...  MOVZ 32: 0 10 1001 01
  const op = (insn >>> 23) & 0x1ff;
  // simplified: match known encodings we care about
  if ((insn & 0xffe00000) === 0xd2800000) {
    // movz x
    return { rd: insn & 0x1f, imm: (insn >> 5) & 0xffff, is64: true };
  }
  if ((insn & 0xffe00000) === 0x52800000) {
    // movz w
    return { rd: insn & 0x1f, imm: (insn >> 5) & 0xffff, is64: false };
  }
  return null;
}

function decodeCbzCbnz(insn: number): { rt: number; isNz: boolean; is64: boolean } | null {
  // CBZ 32: 0011 0100 ... CBNZ 0011 0101
  // CBZ 64: 1011 0100 ... CBNZ 1011 0101
  if ((insn & 0x7e000000) !== 0x34000000) return null;
  const is64 = (insn & 0x80000000) !== 0;
  const isNz = (insn & 0x01000000) !== 0;
  const rt = insn & 0x1f;
  return { rt, isNz, is64 };
}

/**
 * After PRO string xref: follow window and collect register ops that look like
 * return-false / branch-on-flag (movz Rd,#0/#1, cbz/cbnz Rd).
 */
export function scanRegistersAfterXref(
  buf: Uint8Array,
  xrefPc: number,
  windowBytes = 0x100
): {
  offset: number;
  reg: string;
  kind: "movz0" | "movz1" | "cbz" | "cbnz";
  hex: string;
  patchHex?: string;
}[] {
  const out: {
    offset: number;
    reg: string;
    kind: "movz0" | "movz1" | "cbz" | "cbnz";
    hex: string;
    patchHex?: string;
  }[] = [];
  const start = xrefPc & ~3;
  const end = Math.min(buf.length - 4, xrefPc + windowBytes);
  for (let off = start; off < end; off += 4) {
    const insn = readU32LE(buf, off);
    const mov = decodeMovzImm(insn);
    if (mov && mov.rd === 0) {
      // x0/w0 return value — most important for Dart getters
      if (mov.imm === 0) {
        out.push({
          offset: off,
          reg: mov.is64 ? "x0" : "w0",
          kind: "movz0",
          hex: mov.is64 ? "00 00 80 D2" : "00 00 80 52",
          patchHex: mov.is64 ? "20 00 80 D2" : "20 00 80 52",
        });
      } else if (mov.imm === 1) {
        out.push({
          offset: off,
          reg: mov.is64 ? "x0" : "w0",
          kind: "movz1",
          hex: mov.is64 ? "20 00 80 D2" : "20 00 80 52",
        });
      }
    }
    const cb = decodeCbzCbnz(insn);
    if (cb) {
      out.push({
        offset: off,
        reg: (cb.is64 ? "x" : "w") + cb.rt,
        kind: cb.isNz ? "cbnz" : "cbz",
        hex: bufferToHex(buf, off, 4),
      });
    }
  }
  return out;
}

export interface ReScanInput {
  buffer: Uint8Array;
  textRange?: TextRange | null;
  /** string hits: key + offset in file */
  strings: { key: string; offset: number }[];
}

/**
 * Main entry: produce ranked code candidates for Manual Patch.
 */
export function scanCodeCandidates(input: ReScanInput): CodeCandidate[] {
  const buf = input.buffer;
  const text = input.textRange || defaultTextRange(buf.length);
  const candidates: CodeCandidate[] = [];
  const seen = new Set<number>();

  const push = (c: CodeCandidate) => {
    if (seen.has(c.offset)) {
      // keep higher score
      const i = candidates.findIndex((x) => x.offset === c.offset);
      if (i >= 0 && candidates[i].score < c.score) candidates[i] = c;
      return;
    }
    seen.add(c.offset);
    candidates.push(c);
  };

  // Sort strings by priority
  const strings = [...input.strings].sort((a, b) => {
    const pa = PRIORITY_KEYS.findIndex((k) => a.key === k || a.key.includes(k));
    const pb = PRIORITY_KEYS.findIndex((k) => b.key === k || b.key.includes(k));
    const sa = pa === -1 ? 50 : pa;
    const sb = pb === -1 ? 50 : pb;
    return sa - sb;
  });

  // 1) ADRP+ADD xrefs for high-value strings
  for (const s of strings.slice(0, 12)) {
    if (s.offset >= text.start) continue; // string should be in data
    const xrefs = findAdrpAddXrefs(buf, s.offset, text, 25);
    for (const xrefPc of xrefs) {
      // search movz/ret in a window after the materialization (common: compare then return)
      const windowFrom = xrefPc;
      const windowTo = Math.min(text.end, xrefPc + 0x120);
      const regs = scanRegistersAfterXref(buf, xrefPc, 0x120);
      const sites = findMovzRetInWindow(buf, windowFrom, windowTo, 20);
      for (const site of sites) {
        const isX0 = site.isX0;
        const movzHex = isX0 ? "00 00 80 D2" : "00 00 80 52";
        const patchHex = isX0 ? "20 00 80 D2" : "20 00 80 52";
        const dist = site.offset - xrefPc;
        let score = 55;
        if (/ownsPro|isPro|isPremium/i.test(s.key)) score += 25;
        if (s.key.startsWith("get:")) score += 10;
        if (dist >= 0 && dist < 0x40) score += 15;
        else if (dist < 0x80) score += 8;
        const regHit = regs.find((r) => r.offset === site.offset);
        if (regHit) score = Math.min(99, score + 10);
        score = Math.min(99, score);
        const regNote = regHit ? ` reg=${regHit.reg}` : " reg=x0/w0";
        push({
          offset: site.offset,
          hexOffset: "0x" + site.offset.toString(16).toUpperCase().padStart(8, "0"),
          stringKey: s.key,
          stringOffset: s.offset,
          reason: `ADRP+ADD xref → ${s.key} (Δ=${dist}B) + movz+ret${regNote}`,
          score,
          movzHex,
          patchHex,
          disasm: disasmAround(buf, site.offset, 6).map((l) => ({
            ...l,
            isCenter: Math.abs(l.offset - site.offset) < 4,
          })),
          kind: "adrp_xref",
        });
      }
      // Extra: register ops in window even without tight ret (cmp/cbz chain)
      for (const r of regs.filter((x) => x.kind === "movz0" && x.patchHex)) {
        if (sites.some((s) => s.offset === r.offset)) continue;
        push({
          offset: r.offset,
          hexOffset: "0x" + r.offset.toString(16).toUpperCase().padStart(8, "0"),
          stringKey: s.key,
          stringOffset: s.offset,
          reason: `После xref ${s.key}: ${r.kind} ${r.reg} (регистр возврата)`,
          score: /ownsPro|isPro/i.test(s.key) ? 62 : 48,
          movzHex: r.hex,
          patchHex: r.patchHex || "",
          disasm: disasmAround(buf, r.offset, 6).map((l) => ({
            ...l,
            isCenter: Math.abs(l.offset - r.offset) < 4,
          })),
          kind: "adrp_xref",
        });
      }
      // if no movz in window, still offer xref PC as investigation point (lower score)
      if (sites.length === 0) {
        push({
          offset: xrefPc,
          hexOffset: "0x" + xrefPc.toString(16).toUpperCase().padStart(8, "0"),
          stringKey: s.key,
          stringOffset: s.offset,
          reason: `ADRP+ADD xref to ${s.key} (inspect manually)`,
          score: 35,
          movzHex: bufferToHex(buf, xrefPc, 4),
          patchHex: "",
          disasm: disasmAround(buf, xrefPc, 8).map((l) => ({
            ...l,
            isCenter: Math.abs(l.offset - xrefPc) < 4,
          })),
          kind: "adrp_xref",
        });
      }
    }
  }

  // 2) Global safe imm_ret sites (no string link) — lower priority
  if (candidates.filter((c) => c.score >= 60).length < 5) {
    const sites = findSafeImmRetSites(buf, text, 40);
    for (const site of sites.slice(0, 15)) {
      const isX0 = site.isX0;
      push({
        offset: site.offset,
        hexOffset: "0x" + site.offset.toString(16).toUpperCase().padStart(8, "0"),
        stringKey: "",
        stringOffset: -1,
        reason: "imm movz#0 + ret ≤12B in .text (no string xref)",
        score: 28,
        movzHex: isX0 ? "00 00 80 D2" : "00 00 80 52",
        patchHex: isX0 ? "20 00 80 D2" : "20 00 80 52",
        disasm: disasmAround(buf, site.offset, 5).map((l) => ({
          ...l,
          isCenter: Math.abs(l.offset - site.offset) < 4,
        })),
        kind: "near_imm_ret",
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.offset - b.offset);
  return candidates.slice(0, 60);
}

export function formatCandidateLine(c: CodeCandidate): string {
  const key = c.stringKey ? ` ← ${c.stringKey}` : "";
  return `${c.hexOffset}  score=${c.score}  ${c.movzHex} → ${c.patchHex || "?"}${key}`;
}
