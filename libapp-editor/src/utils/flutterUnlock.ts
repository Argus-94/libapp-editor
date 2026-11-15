/**
 * Flutter AOT auto-unlock heuristics for libapp.so
 *
 * WHY STRING-NEARBY FAILS
 * -----------------------
 * In real Flutter AOT snapshots (see sample libapp.so ~12MB AArch64):
 * - Names like "isPro", "purchased" live in the DATA / object-pool area
 *   (e.g. ~0x0010554C).
 * - Executable code with returns lives much higher (e.g. from ~0x4C0000).
 * - Distance is often megabytes → "patch bool next to string" finds nothing.
 *
 * WHAT WORKS BETTER (still heuristic)
 * ----------------------------------
 * Many trivial Dart bool getters compile roughly to:
 *   movz x0, #0    ; FALSE   bytes LE: 00 00 80 D2
 *   ret                  C0 03 5F D6
 * or the same with a few instructions between movz and ret.
 *
 * Flutter here uses x0 (64-bit) far more than w0:
 *   movz w0,#0  (00 00 80 52) → often 0 hits
 *   movz x0,#0  (00 00 80 D2) → hundreds of hits
 *
 * AUTO STRATEGY
 * -------------
 * 1) Patch every "movz x0,#0" that is followed by ret within 0..12 bytes
 *    (instruction-aligned) into "movz x0,#1".
 * 2) Same for classic w0 encodings if present.
 * 3) Do NOT globally flip all 800+ false immediates — that breaks the app.
 *
 * LIMITS
 * ------
 * - Does NOT prove a site is isPro/purchased — only "returns false soon".
 * - Proper unlock: Blutter / R2 xref to real getter, then Manual Patch.
 * - Default safe=true, maxPatches=5 (v2.x). Aggressive near_ret can crash apps.
 * - User must re-sign APK after replacing libapp.so.
 */

import { replaceAt, hexToBytes, findAll, bufferToHex } from "./binary";

export interface FlutterUnlockHit {
  offset: number;
  hexOffset: string;
  kind: "imm_ret" | "near_ret";
  reg: "x0" | "w0";
  oldHex: string;
  newHex: string;
}

export interface FlutterUnlockResult {
  buffer: Uint8Array;
  hits: FlutterUnlockHit[];
  stats: {
    x0FalseBefore: number;
    x0TrueBefore: number;
    x0FalseAfter: number;
    x0TrueAfter: number;
    patched: number;
  };
  notes: string[];
}

const RET = hexToBytes("C0035FD6");

const PAIRS: { reg: "x0" | "w0"; false: string; true: string }[] = [
  { reg: "x0", false: "000080D2", true: "200080D2" },
  { reg: "w0", false: "00008052", true: "20008052" },
];

function countPat(buf: Uint8Array, hex: string): number {
  return findAll(buf, hexToBytes(hex), 1_000_000).length;
}

/**
 * Automatic Flutter-oriented unlock.
 * safe=true  → only immediate movz+ret
 * safe=false → movz + ret within 12 bytes (aligned)
 */
export function flutterAutoUnlock(
  input: Uint8Array,
  opts: { safe?: boolean; maxPatches?: number } = {}
): FlutterUnlockResult {
  /** Default SAFE — mass near_ret has crashed real apps (e.g. Dron Alerts 3.3.0) */
  const safe = opts.safe ?? true;
  const maxPatches = opts.maxPatches ?? 5;
  // Один clone, дальше mutate in-place — критично для 12+ МБ файлов
  const buf = new Uint8Array(input);
  const hits: FlutterUnlockHit[] = [];
  const notes: string[] = [
    "Strategy: movz x0/w0 #0 → #1 when ret follows closely (Dart bool getter heuristic).",
    "Strings isPro/purchased are NOT patched (names only).",
    "For precise Pro unlock use Blutter to locate the real getter.",
  ];

  const x0FalseBefore = countPat(buf, "000080D2");
  const x0TrueBefore = countPat(buf, "200080D2");

  for (const pair of PAIRS) {
    const falseB = hexToBytes(pair.false);
    const trueB = hexToBytes(pair.true);
    // Ищем по текущему состоянию буфера (после предыдущих pair)
    const sites = findAll(buf, falseB, 1_000_000);

    for (const off of sites) {
      if (hits.length >= maxPatches) break;

      let kind: FlutterUnlockHit["kind"] | null = null;

      // immediate ret
      if (
        off + 8 <= buf.length &&
        buf[off + 4] === RET[0] &&
        buf[off + 5] === RET[1] &&
        buf[off + 6] === RET[2] &&
        buf[off + 7] === RET[3]
      ) {
        kind = "imm_ret";
      } else if (!safe) {
        // ret within next 12 bytes, 4-byte aligned
        const limit = Math.min(12, buf.length - off - 4);
        for (let d = 4; d <= limit; d += 4) {
          if (
            buf[off + d] === RET[0] &&
            buf[off + d + 1] === RET[1] &&
            buf[off + d + 2] === RET[2] &&
            buf[off + d + 3] === RET[3]
          ) {
            kind = "near_ret";
            break;
          }
        }
      }

      if (!kind) continue;

      replaceAt(buf, off, trueB, true); // in-place
      hits.push({
        offset: off,
        hexOffset: "0x" + off.toString(16).toUpperCase().padStart(8, "0"),
        kind,
        reg: pair.reg,
        oldHex: bufferToHex(falseB),
        newHex: bufferToHex(trueB),
      });
    }
  }

  const x0FalseAfter = countPat(buf, "000080D2");
  const x0TrueAfter = countPat(buf, "200080D2");

  notes.push(
    `Patched ${hits.length} sites (imm_ret=${hits.filter((h) => h.kind === "imm_ret").length}, near_ret=${hits.filter((h) => h.kind === "near_ret").length}).`
  );
  notes.push(
    `x0 #0: ${x0FalseBefore}→${x0FalseAfter}; x0 #1: ${x0TrueBefore}→${x0TrueAfter}.`
  );

  return {
    buffer: buf,
    hits,
    stats: {
      x0FalseBefore,
      x0TrueBefore,
      x0FalseAfter,
      x0TrueAfter,
      patched: hits.length,
    },
    notes,
  };
}
