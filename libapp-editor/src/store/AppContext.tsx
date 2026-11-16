import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
  useMemo,
} from "react";
import { soFingerprint } from "../utils/hash";
import { QueuedPatch, makePatchId } from "../domain/patchQueue";
import { AnalyzeReport } from "../utils/analyze";
import { clearSessionMeta } from "./storage";
import { persistSession } from "../services/fileSession";
import { TextRange } from "../utils/onDeviceRe";

interface FileState {
  buffer: Uint8Array | null;
  /** pristine copy for Compare / revert */
  originalBuffer: Uint8Array | null;
  fileName: string;
  fileUri: string | null;
  backupUri: string | null;
  abi: string | null;
  readyForApk: boolean;
  dirty: boolean;
  fingerprint: string | null;
  textRange: TextRange | null;
  lastReport: AnalyzeReport | null;
  patchQueue: QueuedPatch[];
  setFile: (
    buffer: Uint8Array,
    fileName: string,
    fileUri?: string | null,
    meta?: { backupUri?: string | null; abi?: string | null }
  ) => void;
  updateBuffer: (buffer: Uint8Array, opts?: { markDirty?: boolean }) => void;
  setBackupUri: (uri: string | null) => void;
  setAbi: (abi: string | null) => void;
  setReadyForApk: (v: boolean) => void;
  setTextRange: (r: TextRange | null) => void;
  setLastReport: (r: AnalyzeReport | null) => void;
  enqueuePatch: (p: Omit<QueuedPatch, "id">) => void;
  removePatch: (id: string) => void;
  clearQueue: () => void;
  markClean: () => void;
  revertToOriginal: () => boolean;
  clear: () => void;
}

const Ctx = createContext<FileState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [buffer, setBuffer] = useState<Uint8Array | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [backupUri, setBackupUriState] = useState<string | null>(null);
  const [abi, setAbiState] = useState<string | null>(null);
  const [readyForApk, setReadyForApkState] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [textRange, setTextRangeState] = useState<TextRange | null>(null);
  const [lastReport, setLastReport] = useState<AnalyzeReport | null>(null);
  const [patchQueue, setPatchQueue] = useState<QueuedPatch[]>([]);

  const setTextRange = useCallback(
    (r: TextRange | null) => {
      setTextRangeState(r);
      persistSession({
        fileName: fileName || "libapp.so",
        fingerprint,
        dirty,
        textRange: r ? { start: r.start, end: r.end } : null,
      }).catch(() => {});
    },
    [fileName, fingerprint, dirty]
  );

  const setFile = useCallback(
    (
      buf: Uint8Array,
      name: string,
      uri?: string | null,
      meta?: { backupUri?: string | null; abi?: string | null }
    ) => {
      setBuffer(buf);
      setOriginalBuffer(new Uint8Array(buf));
      setFileName(name);
      setFileUri(uri ?? null);
      setReadyForApkState(false);
      setDirty(false);
      setLastReport(null);
      setTextRangeState(null);
      setPatchQueue([]);
      let fp: string | null = null;
      try {
        fp = soFingerprint(buf);
        setFingerprint(fp);
      } catch {
        setFingerprint(null);
      }
      persistSession({
        fileName: name,
        fingerprint: fp,
        dirty: false,
        textRange: null,
      }).catch(() => {});
      if (meta?.backupUri !== undefined) setBackupUriState(meta.backupUri);
      if (meta?.abi !== undefined) setAbiState(meta.abi);
      if (meta?.abi === undefined && name.includes("/")) {
        const part = name.split("/")[0];
        if (part.startsWith("arm") || part.startsWith("x86")) setAbiState(part);
      }
    },
    []
  );

  const updateBuffer = useCallback((buf: Uint8Array, opts?: { markDirty?: boolean }) => {
    setBuffer(buf);
    setReadyForApkState(false);
    const isDirty = opts?.markDirty === false ? false : true;
    if (opts?.markDirty === false) setDirty(false);
    else setDirty(true);
    let fp: string | null = null;
    try {
      fp = soFingerprint(buf);
      setFingerprint(fp);
    } catch {
      /* keep previous */
    }
    persistSession({
      fileName: fileName || "libapp.so",
      fingerprint: fp,
      dirty: isDirty,
      textRange: null,
    }).catch(() => {});
  }, [fileName]);

  const markClean = useCallback(() => {
    setDirty(false);
    if (buffer) {
      setOriginalBuffer(new Uint8Array(buffer));
      let fp: string | null = null;
      try {
        fp = soFingerprint(buffer);
        setFingerprint(fp);
      } catch {
        /* */
      }
      persistSession({
        fileName: fileName || "libapp.so",
        fingerprint: fp,
        dirty: false,
        textRange: textRange ? { start: textRange.start, end: textRange.end } : null,
      }).catch(() => {});
    }
  }, [buffer, fileName, textRange]);

  const revertToOriginal = useCallback(() => {
    if (!originalBuffer) return false;
    setBuffer(new Uint8Array(originalBuffer));
    setDirty(false);
    setReadyForApkState(false);
    setPatchQueue([]);
    let fp: string | null = null;
    try {
      fp = soFingerprint(originalBuffer);
      setFingerprint(fp);
    } catch {
      /* */
    }
    persistSession({
      fileName: fileName || "libapp.so",
      fingerprint: fp,
      dirty: false,
      textRange: null,
    }).catch(() => {});
    return true;
  }, [originalBuffer, fileName]);

  const enqueuePatch = useCallback((p: Omit<QueuedPatch, "id">) => {
    const id = makePatchId(p.offset, p.newHex);
    setPatchQueue((q) => {
      if (q.some((x) => x.id === id)) return q;
      return [...q, { ...p, id }];
    });
  }, []);

  const removePatch = useCallback((id: string) => {
    setPatchQueue((q) => q.filter((x) => x.id !== id));
  }, []);

  const clearQueue = useCallback(() => setPatchQueue([]), []);

  const clear = useCallback(() => {
    setBuffer(null);
    setOriginalBuffer(null);
    setFileName("");
    setFileUri(null);
    setBackupUriState(null);
    setAbiState(null);
    setReadyForApkState(false);
    setDirty(false);
    setFingerprint(null);
    setTextRangeState(null);
    setLastReport(null);
    setPatchQueue([]);
    clearSessionMeta().catch(() => {});
  }, []);

  const value = useMemo(
    () => ({
      buffer,
      originalBuffer,
      fileName,
      fileUri,
      backupUri,
      abi,
      readyForApk,
      dirty,
      fingerprint,
      textRange,
      lastReport,
      patchQueue,
      setFile,
      updateBuffer,
      setBackupUri: setBackupUriState,
      setAbi: setAbiState,
      setReadyForApk: setReadyForApkState,
      setTextRange,
      setLastReport,
      enqueuePatch,
      removePatch,
      clearQueue,
      markClean,
      revertToOriginal,
      clear,
    }),
    [
      buffer,
      originalBuffer,
      fileName,
      fileUri,
      backupUri,
      abi,
      readyForApk,
      dirty,
      fingerprint,
      textRange,
      lastReport,
      patchQueue,
      setFile,
      updateBuffer,
      setTextRange,
      enqueuePatch,
      removePatch,
      clearQueue,
      markClean,
      revertToOriginal,
      clear,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppFile() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppFile outside AppProvider");
  return v;
}
