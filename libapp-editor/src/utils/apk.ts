import JSZip from "jszip";
import * as FileSystem from "expo-file-system";
import { base64ToUint8, uint8ToBase64 } from "./binary";
import { soFingerprint } from "./hash";

export interface ExtractedSo {
  path: string;
  abi: string;
  data: Uint8Array;
  size: number;
  fingerprint: string;
}

export interface InjectResult {
  base64: string;
  report: {
    path: string;
    beforeFp: string;
    afterFp: string;
    sizeBefore: number;
    sizeAfter: number;
    ok: boolean;
  }[];
  strippedSignatures: string[];
}

const MAX_APK_BYTES = 55 * 1024 * 1024;

export async function getFileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  return info.exists && "size" in info && typeof info.size === "number" ? info.size : 0;
}

export async function extractLibappFromApk(apkUri: string): Promise<ExtractedSo[]> {
  const size = await getFileSize(apkUri);
  if (size > MAX_APK_BYTES) {
    throw new Error(
      `APK слишком большой (${(size / 1024 / 1024).toFixed(1)} MB).\n\n` +
        `Телефон не может загрузить его целиком в память.\n\n` +
        `Сделай так:\n` +
        `1. На ПК открой APK как ZIP\n` +
        `2. Достань lib/arm64-v8a/libapp.so\n` +
        `3. Открой этот .so во вкладке «Поиск»`
    );
  }
  if (size === 0) {
    throw new Error("Не удалось определить размер файла");
  }

  const base64 = await FileSystem.readAsStringAsync(apkUri, { encoding: "base64" });
  const binary = base64ToUint8(base64);

  const zip = await JSZip.loadAsync(binary);
  const results: ExtractedSo[] = [];

  const paths = Object.keys(zip.files).filter(
    (p) => p.endsWith("libapp.so") && p.startsWith("lib/")
  );

  for (const path of paths) {
    const file = zip.file(path);
    if (!file) continue;
    const buf = await file.async("uint8array");
    const parts = path.split("/");
    const abi = parts[1] || "unknown";
    results.push({
      path,
      abi,
      data: buf,
      size: buf.length,
      fingerprint: soFingerprint(buf),
    });
  }

  return results;
}

/**
 * Inject patched libapp.so using STORE (no deflate) — safer for native libs.
 * Strips META-INF signature files so the user must re-sign.
 */
export async function injectLibappIntoApk(
  apkUri: string,
  replacements: { path: string; data: Uint8Array }[]
): Promise<InjectResult> {
  const size = await getFileSize(apkUri);
  if (size > MAX_APK_BYTES) {
    throw new Error(
      `APK ${(size / 1024 / 1024).toFixed(1)} MB — слишком большой для сборки на телефоне.\n` +
        `Подмени libapp.so в APK на ПК (ZIP) и переподпиши.`
    );
  }

  const base64 = await FileSystem.readAsStringAsync(apkUri, { encoding: "base64" });
  const binary = base64ToUint8(base64);
  const zip = await JSZip.loadAsync(binary);

  const report: InjectResult["report"] = [];

  for (const r of replacements) {
    const existing = zip.file(r.path);
    let beforeFp = "--------";
    let sizeBefore = 0;
    if (existing) {
      const prev = await existing.async("uint8array");
      beforeFp = soFingerprint(prev);
      sizeBefore = prev.length;
    }
    // STORE: do not compress .so
    zip.file(r.path, r.data, { compression: "STORE" });
    const afterFp = soFingerprint(r.data);
    report.push({
      path: r.path,
      beforeFp,
      afterFp,
      sizeBefore,
      sizeAfter: r.data.length,
      ok: r.data.length > 0 && afterFp.length === 8,
    });
  }

  // Strip v1 signature blocks — otherwise package is inconsistent
  const strippedSignatures: string[] = [];
  const metaNames = Object.keys(zip.files).filter((p) => {
    const u = p.toUpperCase();
    return (
      u.startsWith("META-INF/") &&
      (u.endsWith(".SF") ||
        u.endsWith(".RSA") ||
        u.endsWith(".DSA") ||
        u.endsWith(".EC") ||
        u.endsWith("MANIFEST.MF"))
    );
  });
  for (const n of metaNames) {
    zip.remove(n);
    strippedSignatures.push(n);
  }

  const outBase64 = await zip.generateAsync({
    type: "base64",
    // Default compression for other entries; replaced .so already STORE
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  return { base64: outBase64, report, strippedSignatures };
}

export async function saveAndShare(
  base64: string,
  fileName: string,
  mimeType = "application/vnd.android.package-archive"
) {
  const Sharing = await import("expo-sharing");
  const outUri = (FileSystem.cacheDirectory || "") + fileName;
  await FileSystem.writeAsStringAsync(outUri, base64, { encoding: "base64" });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(outUri, {
      mimeType,
      dialogTitle: `Сохранить ${fileName}`,
    });
  }
  return outUri;
}

/** Compare fingerprints of in-memory SO vs entry still needed after inject */
export function describeInjectReport(report: InjectResult["report"]): string {
  return report
    .map(
      (r) =>
        `${r.path}\n  size ${r.sizeBefore} → ${r.sizeAfter}\n  fp ${r.beforeFp} → ${r.afterFp}`
    )
    .join("\n");
}
