import AsyncStorage from "@react-native-async-storage/async-storage";
import { PatchRecord, PatchPreset, Bookmark, AppSettings } from "../types";

const KEYS = {
  history: "@libapp/history",
  presets: "@libapp/presets",
  bookmarks: "@libapp/bookmarks",
  settings: "@libapp/settings",
  lastAnalyze: "@libapp/lastAnalyze",
};

const DEFAULT_SETTINGS: AppSettings = {
  accent: "gold",
  autoBackup: true,
  maxHistory: 200,
};

export async function loadHistory(): Promise<PatchRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.history);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveHistory(list: PatchRecord[]) {
  await AsyncStorage.setItem(KEYS.history, JSON.stringify(list));
}

/** Добавить запись в историю с учётом settings.maxHistory */
export async function addHistoryRecord(rec: Omit<PatchRecord, "id" | "timestamp"> & { id?: string; timestamp?: number }) {
  const settings = await loadSettings();
  const list = await loadHistory();
  list.unshift({
    ...rec,
    id: rec.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: rec.timestamp || Date.now(),
  });
  const max = Math.max(20, settings.maxHistory || 200);
  await saveHistory(list.slice(0, max));
}

export async function loadPresets(): Promise<PatchPreset[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.presets);
    return raw ? JSON.parse(raw) : getDefaultPresets();
  } catch {
    return getDefaultPresets();
  }
}

export async function savePresets(list: PatchPreset[]) {
  await AsyncStorage.setItem(KEYS.presets, JSON.stringify(list));
}

export async function loadBookmarks(): Promise<Bookmark[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.bookmarks);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveBookmarks(list: Bookmark[]) {
  await AsyncStorage.setItem(KEYS.bookmarks, JSON.stringify(list));
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.settings);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(s: AppSettings) {
  await AsyncStorage.setItem(KEYS.settings, JSON.stringify(s));
}

export interface LastAnalyzeSummary {
  fileName: string;
  fileSize: number;
  riskLevel: string;
  riskScore: number;
  immRet: number;
  nearRet12: number;
  topKeys: string[];
  fingerprint: string;
  analyzedAt: number;
}

export async function saveLastAnalyze(s: LastAnalyzeSummary) {
  await AsyncStorage.setItem(KEYS.lastAnalyze, JSON.stringify(s));
}

export async function loadLastAnalyze(): Promise<LastAnalyzeSummary | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.lastAnalyze);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getDefaultPresets(): PatchPreset[] {
  return [
    {
      id: "preset-x0-true",
      name: "Flutter x0 false → true",
      description: "movz x0,#0 → movz x0,#1 (основной паттерн Flutter AOT)",
      createdAt: Date.now(),
      patches: [
        { search: "00 00 80 D2", searchType: "hex", replace: "20 00 80 D2", replaceType: "hex" },
      ],
    },
    {
      id: "preset-bool-true",
      name: "ARM64 w0 false → true",
      description: "movz w0,#0 → movz w0,#1",
      createdAt: Date.now(),
      patches: [
        { search: "00 00 80 52", searchType: "hex", replace: "20 00 80 52", replaceType: "hex" },
      ],
    },
    {
      id: "preset-bool-false",
      name: "ARM64 true → false",
      description: "movz w0/x0 #1 → #0",
      createdAt: Date.now(),
      patches: [
        { search: "20 00 80 52", searchType: "hex", replace: "00 00 80 52", replaceType: "hex" },
        { search: "20 00 80 D2", searchType: "hex", replace: "00 00 80 D2", replaceType: "hex" },
      ],
    },
    {
      id: "preset-string-bool",
      name: "false/true строки",
      description: "Строковые false → true",
      createdAt: Date.now(),
      patches: [
        { search: "false", searchType: "string", replace: "true\0", replaceType: "string" },
      ],
    },
  ];
}

const SESSION_KEY = "@libapp/sessionMeta";

export type SessionMeta = {
  fileName: string;
  fingerprint: string | null;
  dirty: boolean;
  textRange: { start: number; end: number } | null;
  lastRisk?: string;
  savedAt: number;
};

export async function saveSessionMeta(meta: SessionMeta) {
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(meta));
  } catch {
    /* */
  }
}

export async function loadSessionMeta(): Promise<SessionMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function clearSessionMeta() {
  try {
    await AsyncStorage.removeItem(SESSION_KEY);
  } catch {
    /* */
  }
}
