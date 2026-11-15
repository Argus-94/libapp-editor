import { SearchResult } from "../types";

export function bufferToHex(buffer: Uint8Array, start = 0, length?: number): string {
  const end = length !== undefined ? start + length : buffer.length;
  const parts: string[] = [];
  for (let i = start; i < end && i < buffer.length; i++) {
    parts.push(buffer[i].toString(16).padStart(2, "0").toUpperCase());
  }
  return parts.join(" ");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "").replace(/0x/gi, "");
  if (clean.length === 0) throw new Error("Пустой hex");
  if (clean.length % 2 !== 0) throw new Error("Некорректный hex (нечётная длина)");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    const byte = parseInt(clean.substr(i, 2), 16);
    if (isNaN(byte)) throw new Error(`Некорректный hex рядом с позицией ${i}`);
    bytes[i / 2] = byte;
  }
  return bytes;
}

export function findAll(buffer: Uint8Array, pattern: Uint8Array, maxResults = 500): number[] {
  const results: number[] = [];
  if (pattern.length === 0 || buffer.length < pattern.length) return results;

  const first = pattern[0];
  const plen = pattern.length;
  const blen = buffer.length;

  for (let i = 0; i <= blen - plen; i++) {
    if (buffer[i] !== first) continue;
    let match = true;
    for (let j = 1; j < plen; j++) {
      if (buffer[i + j] !== pattern[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      results.push(i);
      if (results.length >= maxResults) break;
    }
  }
  return results;
}

/** Ищем типичные ARM64 bool рядом со строкой (±256 байт). Включает x0 (Flutter AOT). */
function findNearbyBool(buffer: Uint8Array, center: number, radius = 256) {
  const patterns = [
    // w0 (32-bit)
    { hex: "00008052", isTrue: false }, // movz w0, #0
    { hex: "20008052", isTrue: true },  // movz w0, #1
    { hex: "00008012", isTrue: false },
    { hex: "20008012", isTrue: true },
    // x0 (64-bit) — основной паттерн Flutter libapp.so
    { hex: "000080D2", isTrue: false }, // movz x0, #0
    { hex: "200080D2", isTrue: true },  // movz x0, #1
  ];

  const start = Math.max(0, center - radius);
  const end = Math.min(buffer.length - 4, center + radius);

  for (let i = start; i <= end; i++) {
    for (const p of patterns) {
      const b = hexToBytes(p.hex);
      if (buffer[i] === b[0] && buffer[i+1] === b[1] && buffer[i+2] === b[2] && buffer[i+3] === b[3]) {
        return {
          offset: i,
          hex: bufferToHex(b),
          isTrue: p.isTrue,
        };
      }
    }
  }
  return null;
}

export function searchString(buffer: Uint8Array, query: string, smart = true): SearchResult[] {
  const encoder = new TextEncoder();
  const pattern = encoder.encode(query);
  const offsets = findAll(buffer, pattern);

  return offsets.map((offset) => {
    const ctxStart = Math.max(0, offset - 12);
    const ctxEnd = Math.min(buffer.length, offset + pattern.length + 12);
    return {
      offset,
      hexOffset: "0x" + offset.toString(16).toUpperCase().padStart(8, "0"),
      contextHex: bufferToHex(buffer, ctxStart, ctxEnd - ctxStart),
      matchedValue: query,
      type: "string" as const,
      nearbyBool: smart ? findNearbyBool(buffer, offset) : null,
    };
  });
}

export function searchHex(buffer: Uint8Array, hexQuery: string): SearchResult[] {
  const pattern = hexToBytes(hexQuery);
  const offsets = findAll(buffer, pattern);

  return offsets.map((offset) => {
    const ctxStart = Math.max(0, offset - 8);
    const ctxEnd = Math.min(buffer.length, offset + pattern.length + 8);
    return {
      offset,
      hexOffset: "0x" + offset.toString(16).toUpperCase().padStart(8, "0"),
      contextHex: bufferToHex(buffer, ctxStart, ctxEnd - ctxStart),
      matchedValue: bufferToHex(pattern),
      type: "hex" as const,
      nearbyBool: null,
    };
  });
}

/**
 * Замена байт по смещению.
 * Если mutate=true — меняет переданный буфер in-place (быстрее для множественных патчей).
 * Иначе возвращает новый буфер (безопасный режим по умолчанию).
 */
export function replaceAt(
  buffer: Uint8Array,
  offset: number,
  newBytes: Uint8Array,
  mutate = false
): Uint8Array {
  if (offset < 0 || offset + newBytes.length > buffer.length) {
    throw new Error("Смещение выходит за границы файла");
  }
  if (mutate) {
    buffer.set(newBytes, offset);
    return buffer;
  }
  const result = new Uint8Array(buffer);
  result.set(newBytes, offset);
  return result;
}

export function toggleArm64Bool(hex: string): string | null {
  const clean = hex.replace(/\s/g, "").toUpperCase();
  const map: Record<string, string> = {
    // w0
    "00008052": "20008052",
    "20008052": "00008052",
    "00008012": "20008012",
    "20008012": "00008012",
    // x0 — основной паттерн Flutter AOT
    "000080D2": "200080D2",
    "200080D2": "000080D2",
    // ARM32
    "0000A0E3": "0100A0E3",
    "0100A0E3": "0000A0E3",
  };
  return map[clean] ?? null;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let result = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    result += String.fromCharCode(...slice);
  }
  return btoa(result);
}

export function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Сравнение двух буферов — возвращает список отличий */
export interface DiffItem {
  offset: number;
  hexOffset: string;
  oldHex: string;
  newHex: string;
  length: number;
}

export function compareBuffers(a: Uint8Array, b: Uint8Array, maxDiffs = 300): DiffItem[] {
  const len = Math.min(a.length, b.length);
  const diffs: DiffItem[] = [];
  let i = 0;

  while (i < len && diffs.length < maxDiffs) {
    if (a[i] !== b[i]) {
      const start = i;
      while (i < len && a[i] !== b[i] && i - start < 16) i++;
      const length = i - start;
      diffs.push({
        offset: start,
        hexOffset: "0x" + start.toString(16).toUpperCase().padStart(8, "0"),
        oldHex: bufferToHex(a, start, length),
        newHex: bufferToHex(b, start, length),
        length,
      });
    } else {
      i++;
    }
  }
  return diffs;
}

export interface SimplePatch {
  search: string;
  searchType: "string" | "hex";
  replace: string;
  replaceType: "string" | "hex";
  maxOccurrences?: number;
}

export interface ApplyResult {
  buffer: Uint8Array;
  applied: number;
  details: { search: string; count: number }[];
}

/** Применить список патчей к буферу (один clone + in-place) */
export function applyPatches(buffer: Uint8Array, patches: SimplePatch[]): ApplyResult {
  const buf = new Uint8Array(buffer);
  let applied = 0;
  const details: { search: string; count: number }[] = [];

  for (const p of patches) {
    let pattern: Uint8Array;
    let replacement: Uint8Array;

    if (p.searchType === "string") {
      const enc = new TextEncoder();
      pattern = enc.encode(p.search);
      let repStr = p.replace;
      if (repStr.length < p.search.length) {
        repStr = repStr.padEnd(p.search.length, "\0");
      }
      replacement = enc.encode(repStr.slice(0, pattern.length));
    } else {
      pattern = hexToBytes(p.search);
      replacement = hexToBytes(p.replace);
      if (pattern.length !== replacement.length) {
        details.push({ search: p.search, count: 0 });
        continue;
      }
    }

    const max = p.maxOccurrences ?? 50;
    const offsets = findAll(buf, pattern, max);
    for (const off of offsets) {
      replaceAt(buf, off, replacement, true);
      applied++;
    }
    details.push({ search: p.search, count: offsets.length });
  }

  return { buffer: buf, applied, details };
}

/** Простой «дизассемблер» частых ARM64 инструкций (4 байта LE) */
export function decodeArm64(bytes: Uint8Array, offset: number): string {
  if (offset + 4 > bytes.length) return "????";
  const w =
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24);

  // movz wN, #imm (sf=0)
  if ((w & 0xff800000) === 0x52800000) {
    const imm = (w >> 5) & 0xffff;
    const rd = w & 0x1f;
    return `movz w${rd}, #${imm}`;
  }
  // movz xN, #imm (sf=1) — Flutter часто использует x0
  if ((w & 0xff800000) === 0xd2800000) {
    const imm = (w >> 5) & 0xffff;
    const rd = w & 0x1f;
    return `movz x${rd}, #${imm}`;
  }
  // movn wN
  if ((w & 0xff800000) === 0x12800000) {
    const imm = (w >> 5) & 0xffff;
    const rd = w & 0x1f;
    return `movn w${rd}, #${imm}`;
  }
  // movn xN
  if ((w & 0xff800000) === 0x92800000) {
    const imm = (w >> 5) & 0xffff;
    const rd = w & 0x1f;
    return `movn x${rd}, #${imm}`;
  }
  // ret
  if (w === 0xd65f03c0) return "ret";
  // nop
  if (w === 0xd503201f) return "nop";
  // b (unconditional)
  if ((w & 0xfc000000) === 0x14000000) {
    let imm = w & 0x03ffffff;
    if (imm & 0x02000000) imm |= ~0x03ffffff;
    return `b ${imm > 0 ? "+" : ""}${imm * 4}`;
  }
  // bl
  if ((w & 0xfc000000) === 0x94000000) {
    let imm = w & 0x03ffffff;
    if (imm & 0x02000000) imm |= ~0x03ffffff;
    return `bl ${imm > 0 ? "+" : ""}${imm * 4}`;
  }
  // cbz / cbnz
  if ((w & 0xff000000) === 0x34000000) return "cbz ...";
  if ((w & 0xff000000) === 0x35000000) return "cbnz ...";

  return bufferToHex(bytes, offset, 4);
}

export function disasmAround(buffer: Uint8Array, center: number, count = 8): { offset: number; hex: string; asm: string }[] {
  const lines: { offset: number; hex: string; asm: string }[] = [];
  // align to 4
  let start = center - (center % 4) - Math.floor(count / 2) * 4;
  if (start < 0) start = 0;
  for (let i = 0; i < count; i++) {
    const off = start + i * 4;
    if (off + 4 > buffer.length) break;
    lines.push({
      offset: off,
      hex: bufferToHex(buffer, off, 4),
      asm: decodeArm64(buffer, off),
    });
  }
  return lines;
}
