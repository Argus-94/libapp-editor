export interface SearchResult {
  offset: number;
  hexOffset: string;
  contextHex: string;
  matchedValue: string;
  type: "string" | "hex";
  nearbyBool?: {
    offset: number;
    hex: string;
    isTrue: boolean;
  } | null;
}

export interface PatchRecord {
  id: string;
  offset: number;
  hexOffset: string;
  oldValue: string;
  newValue: string;
  type: "string" | "hex";
  timestamp: number;
  note?: string;
  fingerprint?: string;
}

export interface PatchPreset {
  id: string;
  name: string;
  description?: string;
  patches: {
    search: string;
    searchType: "string" | "hex";
    replace: string;
    replaceType: "string" | "hex";
  }[];
  createdAt: number;
}

export interface Bookmark {
  id: string;
  offset: number;
  hexOffset: string;
  label: string;
  value: string;
  fileName?: string;
  createdAt: number;
}

export interface AppSettings {
  accent: "gold" | "emerald" | "blue" | "purple";
  autoBackup: boolean;
  maxHistory: number;
}
