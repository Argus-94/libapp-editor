import { hexToBytes, bufferToHex, replaceAt, findAll } from "./binary";

export const PREMIUM_KEYWORDS = [
  "ispro", "ispremium", "issubscribed", "purchased", "isunlocked",
  "isvip", "hassubscription", "ispaid", "premium", "prouser",
  "isactive", "entitled", "unlocked", "subscribe", "subscription",
  "ispurchase", "buypro", "premiumuser", "haspremium", "checkpremium",
  "islifetime", "lifetime", "trial", "isfree", "freeuser",
];

export function isPremiumKey(s: string): boolean {
  const l = s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PREMIUM_KEYWORDS.some((k) => l.includes(k));
}

/**
 * ARM64 bool-like returns.
 * Flutter AOT often uses x0 (64-bit), not only w0.
 */
const BOOL_PATTERNS = [
  // w0
  { false: "00008052", true: "20008052", name: "movz w0" },
  { false: "00008012", true: "20008012", name: "movn/movz w0 alt" },
  // x0 — частый вариант в Flutter libapp.so
  { false: "000080D2", true: "200080D2", name: "movz x0" },
  // xzr
  { false: "E0031FAA", true: "200080D2", name: "mov x0,xzr→#1" },
  // ARM32 legacy
  { false: "0000A0E3", true: "0100A0E3", name: "ARM32 mov r0" },
];

export interface BoolHit {
  offset: number;
  isTrue: boolean;
  hex: string;
  name: string;
  trueHex: string;
  falseHex: string;
}

export function findBoolsNear(
  buffer: Uint8Array,
  center: number,
  radius = 1024
): BoolHit[] {
  const start = Math.max(0, center - radius);
  const end = Math.min(buffer.length - 4, center + radius);
  const hits: BoolHit[] = [];

  for (const p of BOOL_PATTERNS) {
    const f = hexToBytes(p.false);
    const t = hexToBytes(p.true);
    for (let i = start; i <= end; i++) {
      if (
        buffer[i] === f[0] &&
        buffer[i + 1] === f[1] &&
        buffer[i + 2] === f[2] &&
        buffer[i + 3] === f[3]
      ) {
        hits.push({
          offset: i,
          isTrue: false,
          hex: bufferToHex(f),
          name: p.name,
          trueHex: p.true,
          falseHex: p.false,
        });
      }
      if (
        buffer[i] === t[0] &&
        buffer[i + 1] === t[1] &&
        buffer[i + 2] === t[2] &&
        buffer[i + 3] === t[3]
      ) {
        hits.push({
          offset: i,
          isTrue: true,
          hex: bufferToHex(t),
          name: p.name,
          trueHex: p.true,
          falseHex: p.false,
        });
      }
    }
  }

  const map = new Map<number, BoolHit>();
  for (const h of hits) map.set(h.offset, h);
  return Array.from(map.values()).sort((a, b) => a.offset - b.offset);
}

export interface UnlockResult {
  buffer: Uint8Array;
  patched: number;
  details: string[];
}

export function applyBoolUnlock(
  buffer: Uint8Array,
  hits: BoolHit[],
  forceTrue: boolean,
  max = 16
): UnlockResult {
  // Один clone, дальше in-place
  const buf = new Uint8Array(buffer);
  let patched = 0;
  const details: string[] = [];

  for (const h of hits) {
    if (patched >= max) break;
    if (h.isTrue === forceTrue) continue;
    const next = forceTrue ? h.trueHex : h.falseHex;
    replaceAt(buf, h.offset, hexToBytes(next), true);
    patched++;
    details.push(`0x${h.offset.toString(16)} ${h.hex} → ${next} (${h.name})`);
  }

  if (patched === 0 && hits.length > 0) {
    for (const h of hits.slice(0, Math.min(8, max))) {
      const next = forceTrue ? h.trueHex : h.falseHex;
      replaceAt(buf, h.offset, hexToBytes(next), true);
      patched++;
      details.push(`0x${h.offset.toString(16)} force ${next} (${h.name})`);
    }
  }

  return { buffer: buf, patched, details };
}

export function deepUnlock(
  buffer: Uint8Array,
  centers: number[],
  forceTrue: boolean
): UnlockResult {
  // Один clone на весь deepUnlock
  const buf = new Uint8Array(buffer);
  let patched = 0;
  const details: string[] = [];
  const seen = new Set<number>();

  for (const c of centers) {
    const hits = findBoolsNear(buf, c, 4096);
    const r = applyBoolUnlock(buf, hits, forceTrue, 12);
    // applyBoolUnlock уже вернул свой clone, копируем изменения обратно
    if (r.patched > 0) {
      buf.set(r.buffer);
    }
    for (const d of r.details) {
      const off = parseInt(d.split(" ")[0].replace("0x", ""), 16);
      if (!seen.has(off)) {
        seen.add(off);
        details.push(d);
        patched++;
      }
    }
  }

  // Если рядом пусто — не трогаем весь файл слепо (опасно).
  // Только расширенный радиус по якорям.
  if (patched < 1 && forceTrue) {
    for (const c of centers) {
      const hits = findBoolsNear(buf, c, 65536);
      const r = applyBoolUnlock(buf, hits, forceTrue, 8);
      if (r.patched > 0) {
        buf.set(r.buffer);
      }
      for (const d of r.details) {
        const off = parseInt(d.split(" ")[0].replace("0x", ""), 16);
        if (!seen.has(off)) {
          seen.add(off);
          details.push(d);
          patched++;
        }
      }
      if (patched >= 8) break;
    }
  }

  return { buffer: buf, patched, details };
}

/** Подсказка по HEX для ручного поиска */
export const HEX_HINTS = {
  falseW0: "00 00 80 52",
  trueW0: "20 00 80 52",
  falseX0: "00 00 80 D2",
  trueX0: "20 00 80 D2",
  // Flutter primary
  flutterFalse: "00 00 80 D2",
  flutterTrue: "20 00 80 D2",
};
