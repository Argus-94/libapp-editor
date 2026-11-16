import { saveSessionMeta, loadSessionMeta, clearSessionMeta, SessionMeta } from "../store/storage";

export async function persistSession(partial: Partial<SessionMeta> & { fileName: string }) {
  const prev = (await loadSessionMeta()) || {
    fileName: partial.fileName,
    fingerprint: null,
    dirty: false,
    textRange: null,
    savedAt: Date.now(),
  };
  await saveSessionMeta({
    ...prev,
    ...partial,
    savedAt: Date.now(),
  });
}

export { loadSessionMeta, clearSessionMeta };
