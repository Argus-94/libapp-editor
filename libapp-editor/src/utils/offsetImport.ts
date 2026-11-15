/**
 * Import code offsets from external tools (r2, R2Droid, IDA notes, manual lists).
 */

export interface ImportedOffset {
  offset: number;
  hexOffset: string;
  note: string;
  source: "hex" | "json" | "r2" | "blutter" | "line";
}

const HEX_RE = /(?:0x)?([0-9a-fA-F]{4,12})\b/g;

export function parseOffsetToken(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("0x")) {
    const n = parseInt(s, 16);
    return isNaN(n) ? null : n;
  }
  if (/^[0-9a-f]+$/i.test(s) && /[a-f]/i.test(s)) {
    const n = parseInt(s, 16);
    return isNaN(n) ? null : n;
  }
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

function pushUnique(
  map: Map<number, ImportedOffset>,
  offset: number,
  note: string,
  source: ImportedOffset["source"]
) {
  if (offset < 0 || offset > 0xffffffff) return;
  const prev = map.get(offset);
  if (prev) {
    if (note && !prev.note.includes(note)) {
      prev.note = prev.note ? prev.note + "; " + note : note;
    }
    return;
  }
  map.set(offset, {
    offset,
    hexOffset: "0x" + offset.toString(16).toUpperCase().padStart(8, "0"),
    note: note || "",
    source,
  });
}

/** Parse free-form text: lines, comments, r2, json array */
export function parseOffsetList(text: string): ImportedOffset[] {
  const map = new Map<number, ImportedOffset>();
  const trimmed = text.trim();
  if (!trimmed) return [];

  // JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const j = JSON.parse(trimmed);
      const arr = Array.isArray(j) ? j : j.offsets || j.list || j.entries || [];
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (typeof item === "number") {
            pushUnique(map, item, "", "json");
          } else if (typeof item === "string") {
            const n = parseOffsetToken(item);
            if (n !== null) pushUnique(map, n, "", "json");
          } else if (item && typeof item === "object") {
            const raw = item.offset ?? item.off ?? item.addr ?? item.address ?? item.va;
            const n =
              typeof raw === "number" ? raw : parseOffsetToken(String(raw ?? ""));
            if (n !== null) {
              pushUnique(map, n, String(item.note || item.name || item.symbol || ""), "json");
            }
          }
        }
        if (map.size) return Array.from(map.values()).sort((a, b) => a.offset - b.offset);
      }
    } catch {
      /* fall through to line parser */
    }
  }

  for (const line0 of trimmed.split(/\r?\n/)) {
    const line = line0.trim();
    if (!line || line.startsWith("//") || line.startsWith("#") || line.startsWith(";")) continue;

    // "0xABC note..." or "ABC: note"
    const m =
      line.match(/^(?:0x)?([0-9a-fA-F]{4,12})\s*[:#;\-\s]+(.+)$/i) ||
      line.match(/^(?:0x)?([0-9a-fA-F]{4,12})\s*$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      if (!isNaN(n)) {
        pushUnique(map, n, (m[2] || "").trim(), /;|x\s/.test(line) ? "r2" : "line");
        continue;
      }
    }

    // r2: "0x0040abcd  200080d2  movz x0, #1"
    const r2 = line.match(/0x([0-9a-fA-F]{4,12})/);
    if (r2) {
      const n = parseInt(r2[1], 16);
      if (!isNaN(n)) {
        const note = line.replace(/^.*?0x[0-9a-fA-F]+\s*/, "").slice(0, 80);
        pushUnique(map, n, note, "r2");
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => a.offset - b.offset);
}

export function filterOffsetsInRange(
  list: ImportedOffset[],
  fileSize: number
): { ok: ImportedOffset[]; oob: ImportedOffset[] } {
  const ok: ImportedOffset[] = [];
  const oob: ImportedOffset[] = [];
  for (const o of list) {
    if (o.offset >= 0 && o.offset + 4 <= fileSize) ok.push(o);
    else oob.push(o);
  }
  return { ok, oob };
}
