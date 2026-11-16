import { bufferToHex } from "../utils/binary";

export function hexDiffWindow(
  before: Uint8Array,
  after: Uint8Array,
  offset: number,
  radius = 8
): string {
  const from = Math.max(0, offset - radius);
  const to = Math.min(before.length, offset + radius + 4);
  const a = bufferToHex(before, from, to - from);
  const b = bufferToHex(after, from, Math.min(after.length, to) - from);
  return (
    `window 0x${from.toString(16)}..0x${to.toString(16)}\n` +
    `до:  ${a}\n` +
    `после:${b}`
  );
}
