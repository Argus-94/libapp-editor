/**
 * LibApp Analyzer — deep static report for Flutter libapp.so
 * No Termux/Blutter required. Runs fully on-device.
 */

import { bufferToHex, findAll, hexToBytes, decodeArm64, disasmAround } from "./binary";
import { APP_VERSION } from "../version";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ElfInfo {
  isElf: boolean;
  class: 32 | 64 | 0;
  endian: "le" | "be" | "?";
  machine: string;
  type: string;
  entry: number;
  loadSegments: { offset: number; vaddr: number; filesz: number; flags: string }[];
  textRange: { start: number; end: number } | null;
  snapshotSymbols: { name: string; offset: number; size: number }[];
  snapshotHash: string | null;
}

export interface PatternStats {
  movzX0False: number;
  movzX0True: number;
  movzW0False: number;
  movzW0True: number;
  immRet: number;
  nearRet12: number;
  nearRet32: number;
  retCount: number;
}

export interface StringHit {
  key: string;
  category: string;
  offset: number;
  hexOffset: string;
  context: string;
}

export interface AnalyzeReport {
  version: string;
  fileName: string;
  fileSize: number;
  analyzedAt: number;
  elf: ElfInfo;
  patterns: PatternStats;
  strings: StringHit[];
  getterNames: StringHit[];
  risk: {
    level: RiskLevel;
    score: number;
    reasons: string[];
    autoUnlockAdvice: string;
  };
  notes: string[];
}

const PRO_KEYS = [
  "isPro", "isPremium", "isSubscribed", "purchased", "isUnlocked",
  "isVip", "hasSubscription", "isPaid", "proUser", "hasPremium",
  "ownsPro", "get:ownsPro", "get:isPro", "get:voicePro", "get:servingAdsNow",
  "get:ownedProductId", "get:pro", "proRequired", "proPerks", "ProPerk",
  "noAds", "get:noAdsTitle", "entitlement", "premium", "lifetime",
];

const IAP_KEYS = [
  "in_app_purchase", "BillingClient", "PurchaseStatus", "PurchaseDetails",
  "queryPastPurchases", "buyNonConsumable", "completePurchase", "purchaseStream",
  "ProductDetails", "InAppPurchase", "billingUnavailable", "SKU",
];

const ADS_KEYS = [
  "showAds", "servingAds", "AdMob", "AppLovin", "bannerAd", "interstitial",
  "rewardedAd", "removeAds", "noAds",
];

function readU16(buf: Uint8Array, off: number, le: boolean): number {
  if (off + 2 > buf.length) return 0;
  return le ? buf[off] | (buf[off + 1] << 8) : (buf[off] << 8) | buf[off + 1];
}

function readU32(buf: Uint8Array, off: number, le: boolean): number {
  if (off + 4 > buf.length) return 0;
  return le
    ? buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)
    : (buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3];
}

function readU64(buf: Uint8Array, off: number, le: boolean): number {
  // JS safe integer range — fine for file offsets < 2^53
  const lo = readU32(buf, off, le) >>> 0;
  const hi = readU32(buf, off + 4, le) >>> 0;
  return le ? lo + hi * 0x100000000 : hi + lo * 0x100000000;
}

function parseElf(buf: Uint8Array): ElfInfo {
  const empty: ElfInfo = {
    isElf: false,
    class: 0,
    endian: "?",
    machine: "?",
    type: "?",
    entry: 0,
    loadSegments: [],
    textRange: null,
    snapshotSymbols: [],
    snapshotHash: null,
  };

  if (buf.length < 64 || buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
    return empty;
  }

  const cls = buf[4] === 2 ? 64 : buf[4] === 1 ? 32 : 0;
  const le = buf[5] === 1;
  const machineId = readU16(buf, 18, le);
  const typeId = readU16(buf, 16, le);
  const machine =
    machineId === 183 ? "AArch64" : machineId === 40 ? "ARM" : machineId === 3 ? "x86" : `0x${machineId.toString(16)}`;
  const type =
    typeId === 1 ? "REL" : typeId === 2 ? "EXEC" : typeId === 3 ? "DYN (SO)" : `0x${typeId.toString(16)}`;

  const entry = cls === 64 ? readU64(buf, 24, le) : readU32(buf, 24, le);
  const phoff = cls === 64 ? readU64(buf, 32, le) : readU32(buf, 28, le);
  const phentsize = readU16(buf, cls === 64 ? 54 : 42, le);
  const phnum = readU16(buf, cls === 64 ? 56 : 44, le);

  const loadSegments: ElfInfo["loadSegments"] = [];
  let textRange: ElfInfo["textRange"] = null;

  for (let i = 0; i < phnum; i++) {
    const off = phoff + i * phentsize;
    if (off + phentsize > buf.length) break;
    const pType = readU32(buf, off, le);
    if (pType !== 1) continue; // PT_LOAD
    let pOffset: number, pVaddr: number, pFilesz: number, pFlags: number;
    if (cls === 64) {
      pFlags = readU32(buf, off + 4, le);
      pOffset = readU64(buf, off + 8, le);
      pVaddr = readU64(buf, off + 16, le);
      pFilesz = readU64(buf, off + 32, le);
    } else {
      pOffset = readU32(buf, off + 4, le);
      pVaddr = readU32(buf, off + 8, le);
      pFilesz = readU32(buf, off + 16, le);
      pFlags = readU32(buf, off + 24, le);
    }
    const flags =
      (pFlags & 4 ? "R" : "-") + (pFlags & 2 ? "W" : "-") + (pFlags & 1 ? "X" : "-");
    loadSegments.push({ offset: pOffset, vaddr: pVaddr, filesz: pFilesz, flags });
    if (pFlags & 1) {
      // executable
      textRange = { start: pOffset, end: pOffset + pFilesz };
    }
  }

  // Dynsym snapshot symbols (by scanning .dynstr-like names in first 4KB of common region)
  const snapshotSymbols: ElfInfo["snapshotSymbols"] = [];
  const names = ["_kDartSnapshotData", "_kDartSnapshotText", "_kDartVmSnapshotData", "_kDartSnapshotBuildId"];
  for (const name of names) {
    const enc = new TextEncoder().encode(name);
    const hits = findAll(buf, enc, 5);
    // symbol value is not at string location — we only record string presence as hint
    for (const h of hits.slice(0, 1)) {
      snapshotSymbols.push({ name, offset: h, size: 0 });
    }
  }

  // Snapshot hash: 32 hex chars near start of data segment / after ELF header
  let snapshotHash: string | null = null;
  const head = buf.subarray(0, Math.min(buf.length, 0x800));
  const ascii = Array.from(head, (c) => (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) ? String.fromCharCode(c) : " ").join("");
  const hm = ascii.match(/[a-f0-9]{32}/);
  if (hm) snapshotHash = hm[0];

  // Also search near 0x2c0 (typical snapshot data)
  if (!snapshotHash && buf.length > 0x300) {
    const slice = buf.subarray(0x2c0, Math.min(buf.length, 0x2c0 + 80));
    const s = Array.from(slice, (c) => (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x66) ? String.fromCharCode(c) : "").join("");
    const m = s.match(/[a-f0-9]{32}/);
    if (m) snapshotHash = m[0];
  }

  return {
    isElf: true,
    class: cls as 32 | 64,
    endian: le ? "le" : "be",
    machine,
    type,
    entry,
    loadSegments,
    textRange,
    snapshotSymbols,
    snapshotHash,
  };
}

function countPat(buf: Uint8Array, hex: string): number {
  return findAll(buf, hexToBytes(hex), 2_000_000).length;
}

function patternStats(buf: Uint8Array): PatternStats {
  const falseX0 = hexToBytes("000080D2");
  const trueX0 = hexToBytes("200080D2");
  const falseW0 = hexToBytes("00008052");
  const trueW0 = hexToBytes("20008052");
  const ret = hexToBytes("C0035FD6");

  const movzX0False = countPat(buf, "000080D2");
  const movzX0True = countPat(buf, "200080D2");
  const movzW0False = countPat(buf, "00008052");
  const movzW0True = countPat(buf, "20008052");
  const retCount = countPat(buf, "C0035FD6");

  let immRet = 0;
  let nearRet12 = 0;
  let nearRet32 = 0;

  // Scan false x0 sites for ret distance
  const sites = findAll(buf, falseX0, 50_000);
  for (const off of sites) {
    let found = false;
    if (
      off + 8 <= buf.length &&
      buf[off + 4] === ret[0] &&
      buf[off + 5] === ret[1] &&
      buf[off + 6] === ret[2] &&
      buf[off + 7] === ret[3]
    ) {
      immRet++;
      nearRet12++;
      nearRet32++;
      found = true;
    }
    if (!found) {
      for (let d = 4; d <= 32; d += 4) {
        if (off + d + 4 > buf.length) break;
        if (
          buf[off + d] === ret[0] &&
          buf[off + d + 1] === ret[1] &&
          buf[off + d + 2] === ret[2] &&
          buf[off + d + 3] === ret[3]
        ) {
          if (d <= 12) nearRet12++;
          nearRet32++;
          break;
        }
      }
    }
  }

  // Also w0 imm
  const sitesW = findAll(buf, falseW0, 20_000);
  for (const off of sitesW) {
    if (
      off + 8 <= buf.length &&
      buf[off + 4] === ret[0] &&
      buf[off + 5] === ret[1] &&
      buf[off + 6] === ret[2] &&
      buf[off + 7] === ret[3]
    ) {
      immRet++;
      nearRet12++;
      nearRet32++;
    }
  }

  return {
    movzX0False,
    movzX0True,
    movzW0False,
    movzW0True,
    immRet,
    nearRet12,
    nearRet32,
    retCount,
  };
}

function printableCtx(buf: Uint8Array, off: number, before = 16, after = 32): string {
  const start = Math.max(0, off - before);
  const end = Math.min(buf.length, off + after);
  let s = "";
  for (let i = start; i < end; i++) {
    const c = buf[i];
    s += c >= 32 && c < 127 ? String.fromCharCode(c) : ".";
  }
  return s;
}

function findKeys(buf: Uint8Array, keys: string[], category: string, maxPerKey = 8): StringHit[] {
  const out: StringHit[] = [];
  const enc = new TextEncoder();
  for (const key of keys) {
    const pat = enc.encode(key);
    const offs = findAll(buf, pat, maxPerKey);
    for (const offset of offs) {
      out.push({
        key,
        category,
        offset,
        hexOffset: "0x" + offset.toString(16).toUpperCase().padStart(8, "0"),
        context: printableCtx(buf, offset),
      });
    }
  }
  return out;
}

function computeRisk(patterns: PatternStats, strings: StringHit[], elf: ElfInfo): AnalyzeReport["risk"] {
  const reasons: string[] = [];
  let score = 0;

  if (!elf.isElf) {
    reasons.push("Файл не ELF — анализ ограничен");
    score += 20;
  }
  if (elf.machine !== "AArch64") {
    reasons.push(`Архитектура ${elf.machine} — эвристики x0 рассчитаны на arm64`);
    score += 25;
  }

  if (patterns.nearRet12 === 0 && patterns.immRet === 0) {
    reasons.push("0 сайтов imm/near movz+ret — Auto Unlock ничего не найдёт (или уже пропатчено)");
    score += 15;
  }
  if (patterns.nearRet12 > 40) {
    reasons.push(`Много near_ret (${patterns.nearRet12}) — массовый unlock СКОРЕЕ ВСЕГО уронит приложение`);
    score += 40;
  } else if (patterns.nearRet12 > 15) {
    reasons.push(`near_ret=${patterns.nearRet12} — средний риск краша при aggressive auto`);
    score += 25;
  }
  if (patterns.immRet > 10) {
    reasons.push(`imm_ret=${patterns.immRet} — даже safe-режим может затронуть критичный код`);
    score += 15;
  }

  const hasOwns = strings.some((s) => /ownsPro|get:ownsPro/i.test(s.key));
  const hasIsPro = strings.some((s) => /isPro|isPremium/i.test(s.key));
  if (hasOwns || hasIsPro) {
    reasons.push("Есть строки PRO-геттеров — нужен точечный патч (Blutter/R2), не auto");
    score += 10;
  }

  const hasIap = strings.some((s) => s.category === "iap");
  if (hasIap) {
    reasons.push("Обнаружен in_app_purchase / Billing — PRO часто от магазина, не от movz");
    score += 10;
  }

  let level: RiskLevel = "LOW";
  if (score >= 60) level = "CRITICAL";
  else if (score >= 40) level = "HIGH";
  else if (score >= 20) level = "MEDIUM";

  let autoUnlockAdvice = "";
  if (patterns.immRet === 0 && patterns.nearRet12 === 0) {
    autoUnlockAdvice = "Auto Unlock бесполезен на этом файле. Используй Analyze + Manual offset или внешний RE.";
  } else if (level === "CRITICAL" || level === "HIGH") {
    autoUnlockAdvice =
      "НЕ запускай aggressive Auto Unlock. Максимум: safe, 1–5 патчей, с бэкапом. Лучше manual по offset.";
  } else if (patterns.immRet > 0 && patterns.immRet <= 5) {
    autoUnlockAdvice = `Можно попробовать SAFE (только imm_ret, ≤${patterns.immRet} мест) и сразу проверить запуск.`;
  } else {
    autoUnlockAdvice = "Safe-режим с лимитом 3–5 патчей; после каждого — тест запуска приложения.";
  }

  return { level, score, reasons, autoUnlockAdvice };
}

/** Полный анализ libapp.so */
export function analyzeLibapp(
  buf: Uint8Array,
  fileName = "libapp.so",
  appVersion = APP_VERSION
): AnalyzeReport {
  const elf = parseElf(buf);
  const patterns = patternStats(buf);
  const pro = findKeys(buf, PRO_KEYS, "pro", 6);
  const iap = findKeys(buf, IAP_KEYS, "iap", 4);
  const ads = findKeys(buf, ADS_KEYS, "ads", 4);
  const strings = [...pro, ...iap, ...ads];

  // Getter-like names
  const getterNames = strings.filter(
    (s) => s.key.startsWith("get:") || /^(ownsPro|isPro|isPremium|voicePro|servingAds)/i.test(s.key)
  );

  const risk = computeRisk(patterns, strings, elf);

  const notes: string[] = [
    "Analyze-only: файл не изменяется.",
    "Строки isPro/ownsPro — имена в data/pool, не код геттера.",
    "Для точного PRO нужен offset кода (R2Droid / Blutter), затем Manual Patch.",
    "Массовый flip movz#0→#1 на реальных приложениях часто даёт crash at start.",
  ];

  if (elf.snapshotHash) notes.push(`Snapshot hash: ${elf.snapshotHash}`);
  if (elf.textRange) {
    notes.push(
      `.text (RX): 0x${elf.textRange.start.toString(16)} – 0x${elf.textRange.end.toString(16)}`
    );
  }

  return {
    version: appVersion,
    fileName,
    fileSize: buf.length,
    analyzedAt: Date.now(),
    elf,
    patterns,
    strings,
    getterNames,
    risk,
    notes,
  };
}

/** Дизасм вокруг offset для UI */
export function disasmAt(buf: Uint8Array, offset: number, count = 20) {
  return disasmAround(buf, offset, count).map((l) => ({
    ...l,
    hexOffset: "0x" + l.offset.toString(16).toUpperCase().padStart(8, "0"),
    isCenter: Math.abs(l.offset - offset) < 4,
  }));
}

/** Патч одного bool movz at offset (false↔true) */
export function toggleBoolAt(buf: Uint8Array, offset: number): { buffer: Uint8Array; oldHex: string; newHex: string } | null {
  if (offset < 0 || offset + 4 > buf.length) return null;
  const old = bufferToHex(buf, offset, 4).replace(/\s/g, "");
  const map: Record<string, string> = {
    "000080D2": "200080D2",
    "200080D2": "000080D2",
    "00008052": "20008052",
    "20008052": "00008052",
  };
  const neu = map[old.toUpperCase()];
  if (!neu) return null;
  const out = new Uint8Array(buf);
  const bytes = hexToBytes(neu);
  out.set(bytes, offset);
  return { buffer: out, oldHex: bufferToHex(buf, offset, 4), newHex: bufferToHex(bytes) };
}

/** Произвольная запись hex по offset */
export function patchBytesAt(
  buf: Uint8Array,
  offset: number,
  hex: string
): { buffer: Uint8Array; oldHex: string; newHex: string } {
  const bytes = hexToBytes(hex);
  if (offset < 0 || offset + bytes.length > buf.length) {
    throw new Error("Offset выходит за границы файла");
  }
  const oldHex = bufferToHex(buf, offset, bytes.length);
  const out = new Uint8Array(buf);
  out.set(bytes, offset);
  return { buffer: out, oldHex, newHex: bufferToHex(bytes) };
}
