import { TextRange } from "../utils/onDeviceRe";

/** Warn if patch target is outside executable .text */
export function patchZone(
  offset: number,
  textRange: TextRange | null | undefined
): "text" | "data" | "unknown" {
  if (!textRange) return "unknown";
  if (offset >= textRange.start && offset < textRange.end) return "text";
  return "data";
}

export function zoneMessage(zone: "text" | "data" | "unknown"): string {
  if (zone === "text") return "Offset в .text (код) — нормально для bool-патча.";
  if (zone === "data")
    return "Offset в data, не в коде. Патч строки Pro обычно бесполезен и может повредить so.";
  return "Диапазон .text неизвестен — патчь осторожно.";
}
