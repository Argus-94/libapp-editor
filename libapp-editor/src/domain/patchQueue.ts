export type QueuedPatch = {
  id: string;
  offset: number;
  hexOffset: string;
  oldHex: string;
  newHex: string;
  note?: string;
  source?: string;
};

export function makePatchId(offset: number, newHex: string): string {
  return `${offset}:${newHex.replace(/\s/g, "").toLowerCase()}`;
}

export function applyQueueToBuffer(
  buffer: Uint8Array,
  queue: QueuedPatch[]
): { buffer: Uint8Array; applied: number; errors: string[] } {
  const out = new Uint8Array(buffer);
  let applied = 0;
  const errors: string[] = [];
  for (const p of queue) {
    try {
      const clean = p.newHex.replace(/\s+/g, "");
      if (clean.length % 2 !== 0) {
        errors.push(`${p.hexOffset}: bad hex`);
        continue;
      }
      const bytes = new Uint8Array(clean.length / 2);
      for (let i = 0; i < clean.length; i += 2) {
        bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
      }
      if (p.offset < 0 || p.offset + bytes.length > out.length) {
        errors.push(`${p.hexOffset}: out of range`);
        continue;
      }
      out.set(bytes, p.offset);
      applied++;
    } catch (e: any) {
      errors.push(`${p.hexOffset}: ${e?.message || e}`);
    }
  }
  return { buffer: out, applied, errors };
}
