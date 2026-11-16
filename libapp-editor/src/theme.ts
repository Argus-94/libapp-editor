export type Accent = "gold" | "emerald" | "blue" | "purple";

/**
 * Gold is metallic champagne/antique gold — not lemon yellow.
 * main  — primary accent (text, icons, borders)
 * dark  — pressed / secondary gold
 * light — highlights on dark surfaces
 * soft  — translucent gold backgrounds
 */
const accents: Record<
  Accent,
  { main: string; dark: string; light: string; soft: string }
> = {
  gold: {
    main: "#C9A227",
    dark: "#8B7320",
    light: "#E8D48B",
    soft: "rgba(201, 162, 39, 0.12)",
  },
  emerald: {
    main: "#2ECC71",
    dark: "#1E8449",
    light: "#58D68D",
    soft: "rgba(46, 204, 113, 0.12)",
  },
  blue: {
    main: "#5DADE2",
    dark: "#2E86C1",
    light: "#AED6F1",
    soft: "rgba(93, 173, 226, 0.12)",
  },
  purple: {
    main: "#AF7AC5",
    dark: "#7D3C98",
    light: "#D2B4DE",
    soft: "rgba(175, 122, 197, 0.12)",
  },
};

export function getColors(accent: Accent = "gold") {
  const a = accents[accent];
  return {
    background: "#0A0A0A",
    surface: "#141414",
    surfaceLight: "#1E1E1E",
    surfaceElevated: "#222222",
    gold: a.main,
    goldDark: a.dark,
    goldLight: a.light,
    goldSoft: a.soft,
    text: "#F2F0EA",
    textSecondary: "#9A968C",
    danger: "#E74C3C",
    dangerDark: "#C0392B",
    success: "#27AE60",
    warning: "#E67E22",
    warningSoft: "rgba(230, 126, 34, 0.12)",
    warningSurface: "#2A1A0A",
    border: "#2A2A2A",
    borderGold: "rgba(201, 162, 39, 0.35)",
    overlay: "rgba(0, 0, 0, 0.72)",
    onGold: "#1A1508",
  };
}

/** Mutable current palette — StyleSheet snapshots at import; restart applies accent fully */
let currentAccent: Accent = "gold";
let currentColors = getColors(currentAccent);

/** Live colors object (Proxy so late applyAccent updates runtime reads) */
export const colors: ReturnType<typeof getColors> = new Proxy({} as ReturnType<typeof getColors>, {
  get(_target, prop: string) {
    return (currentColors as Record<string, unknown>)[prop];
  },
});

export function getCurrentAccent(): Accent {
  return currentAccent;
}

/** Apply accent from settings (call on cold start; full StyleSheet refresh needs app restart) */
export function applyAccent(accent: Accent) {
  if (!accents[accent]) return;
  currentAccent = accent;
  currentColors = getColors(accent);
}
