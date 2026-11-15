import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";

interface FileState {
  buffer: Uint8Array | null;
  fileName: string;
  fileUri: string | null;
  backupUri: string | null;
  /** e.g. arm64-v8a when opened from APK */
  abi: string | null;
  /** user marked so as ready to inject into APK */
  readyForApk: boolean;
  setFile: (
    buffer: Uint8Array,
    fileName: string,
    fileUri?: string | null,
    meta?: { backupUri?: string | null; abi?: string | null }
  ) => void;
  updateBuffer: (buffer: Uint8Array) => void;
  setBackupUri: (uri: string | null) => void;
  setAbi: (abi: string | null) => void;
  setReadyForApk: (v: boolean) => void;
  clear: () => void;
}

const Ctx = createContext<FileState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [buffer, setBuffer] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [backupUri, setBackupUriState] = useState<string | null>(null);
  const [abi, setAbiState] = useState<string | null>(null);
  const [readyForApk, setReadyForApkState] = useState(false);

  const setFile = useCallback(
    (
      buf: Uint8Array,
      name: string,
      uri?: string | null,
      meta?: { backupUri?: string | null; abi?: string | null }
    ) => {
      setBuffer(buf);
      setFileName(name);
      setFileUri(uri ?? null);
      setReadyForApkState(false);
      if (meta?.backupUri !== undefined) setBackupUriState(meta.backupUri);
      if (meta?.abi !== undefined) setAbiState(meta.abi);
      // try parse abi from name "arm64-v8a/libapp.so"
      if (meta?.abi === undefined && name.includes("/")) {
        const part = name.split("/")[0];
        if (part.startsWith("arm") || part.startsWith("x86")) setAbiState(part);
      }
    },
    []
  );

  const updateBuffer = useCallback((buf: Uint8Array) => {
    setBuffer(buf);
    setReadyForApkState(false);
  }, []);

  const clear = useCallback(() => {
    setBuffer(null);
    setFileName("");
    setFileUri(null);
    setBackupUriState(null);
    setAbiState(null);
    setReadyForApkState(false);
  }, []);

  return (
    <Ctx.Provider
      value={{
        buffer,
        fileName,
        fileUri,
        backupUri,
        abi,
        readyForApk,
        setFile,
        updateBuffer,
        setBackupUri: setBackupUriState,
        setAbi: setAbiState,
        setReadyForApk: setReadyForApkState,
        clear,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAppFile() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppFile outside AppProvider");
  return v;
}
