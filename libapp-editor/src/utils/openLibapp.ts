import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { base64ToUint8 } from "./binary";
import { logger } from "./logger";
import { loadSettings } from "../store/storage";

export type OpenLibappResult =
  | { ok: true; buffer: Uint8Array; name: string; uri: string; backupUri: string | null }
  | { ok: false; error: string };

/**
 * Shared file picker for libapp.so — used from Home, Analyze, etc.
 */
export async function openLibappFile(): Promise<OpenLibappResult> {
  try {
    const res = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (res.canceled || !res.assets?.[0]) {
      return { ok: false, error: "cancelled" };
    }
    const asset = res.assets[0];
    try {
      const info = await FileSystem.getInfoAsync(asset.uri, { size: true });
      const size =
        info.exists && "size" in info && typeof info.size === "number" ? info.size : 0;
      if (size > 80 * 1024 * 1024) {
        return {
          ok: false,
          error: `Файл слишком большой: ${(size / 1024 / 1024).toFixed(1)} MB (лимит ~80 MB)`,
        };
      }
    } catch {
      /* ignore */
    }

    const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64" });
    const bytes = base64ToUint8(base64);
    logger.info("openLibapp", "opened", { name: asset.name, size: bytes.length });

    let backupUri: string | null = null;
    try {
      const settings = await loadSettings();
      if (settings.autoBackup) {
        backupUri = (FileSystem.cacheDirectory || "") + asset.name + ".bak";
        await FileSystem.writeAsStringAsync(backupUri, base64, { encoding: "base64" });
      }
    } catch {
      /* backup optional */
    }

    return { ok: true, buffer: bytes, name: asset.name || "libapp.so", uri: asset.uri, backupUri };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
