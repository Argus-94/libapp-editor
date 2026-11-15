/** Fast non-crypto hashes for SO integrity checks on device */

export function fnv1aHex(data: Uint8Array, maxBytes = 0): string {
  const len = maxBytes > 0 ? Math.min(data.length, maxBytes) : data.length;
  let h = 0x811c9dc5;
  for (let i = 0; i < len; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193);
  }
  // mix length so different sizes don't collide trivially
  h ^= data.length;
  h = Math.imul(h, 0x01000193);
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

/** Sampled hash: head + mid + tail — fast for 12MB SO */
export function soFingerprint(data: Uint8Array): string {
  if (data.length === 0) return "00000000";
  const chunk = 4096;
  const parts: number[] = [];
  const pushRange = (start: number) => {
    const s = Math.max(0, Math.min(start, data.length));
    const e = Math.min(data.length, s + chunk);
    let h = 0x811c9dc5;
    for (let i = s; i < e; i++) {
      h ^= data[i];
      h = Math.imul(h, 0x01000193);
    }
    parts.push(h >>> 0);
  };
  pushRange(0);
  pushRange(Math.floor(data.length / 2) - chunk / 2);
  pushRange(Math.max(0, data.length - chunk));
  let mix = data.length >>> 0;
  for (const p of parts) {
    mix ^= p;
    mix = Math.imul(mix, 0x01000193) >>> 0;
  }
  return ("00000000" + mix.toString(16)).slice(-8);
}
