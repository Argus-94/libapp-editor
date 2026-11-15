/**
 * In-app ring-buffer logger for debugging LibApp Editor itself.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  tag: string;
  message: string;
  data?: string;
}

const MAX = 1200;
const entries: LogEntry[] = [];
let seq = 1;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function log(level: LogLevel, tag: string, message: string, data?: unknown) {
  let dataStr: string | undefined;
  if (data !== undefined) {
    try {
      dataStr = typeof data === "string" ? data : JSON.stringify(data);
      if (dataStr.length > 2000) dataStr = dataStr.slice(0, 2000) + "…";
    } catch {
      dataStr = String(data);
    }
  }
  entries.push({
    id: seq++,
    ts: Date.now(),
    level,
    tag: String(tag).slice(0, 40),
    message: String(message).slice(0, 1000),
    data: dataStr,
  });
  while (entries.length > MAX) entries.shift();
  notify();
}

export const logger = {
  debug: (tag: string, msg: string, data?: unknown) => log("debug", tag, msg, data),
  info: (tag: string, msg: string, data?: unknown) => log("info", tag, msg, data),
  warn: (tag: string, msg: string, data?: unknown) => log("warn", tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => log("error", tag, msg, data),
};

export function getLogs(filter?: { level?: LogLevel | "all"; tag?: string; q?: string }): LogEntry[] {
  let list = entries.slice();
  if (filter?.level && filter.level !== "all") list = list.filter((e) => e.level === filter.level);
  if (filter?.tag && filter.tag !== "all") list = list.filter((e) => e.tag === filter.tag);
  if (filter?.q) {
    const q = filter.q.toLowerCase();
    list = list.filter(
      (e) =>
        e.message.toLowerCase().includes(q) ||
        e.tag.toLowerCase().includes(q) ||
        (e.data || "").toLowerCase().includes(q)
    );
  }
  return list;
}

export function clearLogs() {
  entries.length = 0;
  notify();
}

export function exportLogsText(): string {
  return entries
    .map((e) => {
      const t = new Date(e.ts).toISOString();
      return `${t} [${e.level.toUpperCase()}] ${e.tag}: ${e.message}${e.data ? " | " + e.data : ""}`;
    })
    .join("\n");
}

/** Import past log lines (from export) back into buffer for comparison */
export function importLogsText(text: string): number {
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(
      /^(\S+)\s+\[(DEBUG|INFO|WARN|ERROR)\]\s+([^:]+):\s+(.*)$/i
    );
    if (!m) continue;
    const level = m[2].toLowerCase() as LogLevel;
    const rest = m[4];
    const parts = rest.split(" | ");
    log(level, m[3].trim(), parts[0] || "", parts.length > 1 ? parts.slice(1).join(" | ") : undefined);
    n++;
  }
  return n;
}

export function subscribeLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function logCount(): number {
  return entries.length;
}

export function listTags(): string[] {
  const s = new Set<string>();
  for (const e of entries) s.add(e.tag);
  return Array.from(s).sort();
}
