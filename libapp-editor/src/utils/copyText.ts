import { Share, Platform } from "react-native";

/**
 * Copy/share text without extra native deps.
 * Prefer Share sheet so user can copy on any device.
 */
export async function copyText(label: string, value: string): Promise<void> {
  try {
    await Share.share({
      message: value,
      title: label,
    });
  } catch {
    // ignore cancel
  }
}

export function formatOffset(offset: number): string {
  return "0x" + offset.toString(16).toUpperCase().padStart(8, "0");
}
