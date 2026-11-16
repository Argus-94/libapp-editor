import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput, Share,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";
import { useDialog } from "../components/DialogProvider";
import {
  getLogs, clearLogs, exportLogsText, importLogsText, subscribeLogs,
  LogEntry, LogLevel, listTags, logCount, logger,
} from "../utils/logger";
import DeveloperFooter from "../components/DeveloperFooter";

const LEVELS: (LogLevel | "all")[] = ["all", "debug", "info", "warn", "error"];

function levelColor(l: LogLevel): string {
  if (l === "error") return colors.danger;
  if (l === "warn") return colors.warning;
  if (l === "info") return "#5DADE2";
  return colors.textSecondary;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return (
    d.toLocaleTimeString() +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

export default function LogcatScreen() {
  const dialog = useDialog();
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [tag, setTag] = useState("all");
  const [q, setQ] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(() => {
    if (paused) return;
    setLogs(getLogs({ level, tag, q: q.trim() || undefined }).slice().reverse());
    setTags(listTags());
  }, [level, tag, q, paused]);

  useEffect(() => {
    refresh();
    const unsub = subscribeLogs(() => refresh());
    logger.debug("Logcat", "screen open", { count: logCount() });
    return unsub;
  }, [refresh]);

  const doExport = async () => {
    const text = exportLogsText();
    if (!text) {
      dialog.alert("Пусто", "Лог пуст");
      return;
    }
    const uri = (FileSystem.cacheDirectory || "") + `libapp_editor_logcat_${Date.now()}.txt`;
    await FileSystem.writeAsStringAsync(uri, text, { encoding: "utf8" });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: "text/plain", dialogTitle: "Export logcat" });
    } else {
      await Share.share({ message: text.slice(0, 8000) });
    }
    logger.info("Logcat", "exported", { chars: text.length });
  };

  const doImport = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["text/plain", "*/*"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const text = await FileSystem.readAsStringAsync(res.assets[0].uri, { encoding: "utf8" });
      const n = importLogsText(text);
      refresh();
      dialog.alert("Импорт", `Добавлено строк: ${n}`);
      logger.info("Logcat", "imported", { n });
    } catch (e: any) {
      dialog.alert("Ошибка", e.message || String(e));
    }
  };

  const doClear = () => {
    dialog.confirm(
      "Очистить лог?",
      `Сейчас ${logCount()} записей`,
      () => {
        clearLogs();
        logger.info("Logcat", "cleared by user");
        refresh();
      },
      "Очистить",
      true
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text style={styles.title} selectable>Logcat · {logCount()}</Text>
        <Text style={styles.sub} selectable>Внутренний лог LibApp Editor (не Android logcat)</Text>

        <TextInput
          style={styles.search}
          placeholder="фильтр…"
          placeholderTextColor={colors.textSecondary}
          value={q}
          onChangeText={setQ}
        />

        <View style={styles.row}>
          {LEVELS.map((l) => (
            <TouchableOpacity
              key={l}
              style={[styles.chip, level === l && styles.chipOn]}
              onPress={() => setLevel(l)}
            >
              <Text style={[styles.chipText, level === l && styles.chipTextOn]} selectable>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {tags.length > 0 && (
          <View style={[styles.row, { flexWrap: "wrap" }]}>
            <TouchableOpacity
              style={[styles.chip, tag === "all" && styles.chipOn]}
              onPress={() => setTag("all")}
            >
              <Text style={[styles.chipText, tag === "all" && styles.chipTextOn]} selectable>all tags</Text>
            </TouchableOpacity>
            {tags.slice(0, 12).map((tg) => (
              <TouchableOpacity
                key={tg}
                style={[styles.chip, tag === tg && styles.chipOn]}
                onPress={() => setTag(tg)}
              >
                <Text style={[styles.chipText, tag === tg && styles.chipTextOn]} selectable>{tg}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.row}>
          <TouchableOpacity style={styles.btn} onPress={() => setPaused((p) => !p)}>
            <Text style={styles.btnText} selectable>{paused ? "Resume" : "Pause"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={doExport}>
            <Text style={styles.btnText} selectable>Export</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={doImport}>
            <Text style={styles.btnText} selectable>Import</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={doClear}>
            <Text style={[styles.btnText, { color: colors.danger }]} selectable>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={logs}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 10, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            onLongPress={() => {
              Share.share({
                message: `${fmtTime(item.ts)} [${item.level}] ${item.tag}: ${item.message}${
                  item.data ? " | " + item.data : ""
                }`,
              });
            }}
          >
            <View style={styles.cardTop}>
              <Text style={[styles.level, { color: levelColor(item.level) }]} selectable>
                {item.level.toUpperCase()}
              </Text>
              <Text style={styles.tag} selectable>{item.tag}</Text>
              <Text style={styles.time} selectable>{fmtTime(item.ts)}</Text>
            </View>
            <Text style={styles.msg} selectable>{item.message}</Text>
            {!!item.data && (
              <Text style={styles.data} numberOfLines={4} selectable>
                {item.data}
              </Text>
            )}
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <Text style={styles.empty} selectable>
            Пока пусто. Открой so, Analyze, Import — события появятся здесь.
          </Text>
        }
        ListFooterComponent={<DeveloperFooter />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  toolbar: { padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.gold, fontWeight: "800", fontSize: 18 },
  sub: { color: colors.textSecondary, fontSize: 12, marginBottom: 8 },
  search: {
    backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border,
    color: colors.text, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8, fontSize: 13,
  },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  chip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipText: { color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  chipTextOn: { color: colors.onGold },
  btn: {
    flex: 1, minWidth: 70, backgroundColor: colors.surface, borderRadius: 8, padding: 8,
    alignItems: "center", borderWidth: 1, borderColor: colors.border,
  },
  btnText: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  card: {
    backgroundColor: colors.surface, borderRadius: 8, padding: 10, marginBottom: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  level: { fontWeight: "900", fontSize: 11, width: 48 },
  tag: { color: colors.gold, fontWeight: "700", fontSize: 12, flex: 1 },
  time: { color: colors.textSecondary, fontSize: 10, fontFamily: "monospace" },
  msg: { color: colors.text, fontSize: 13, lineHeight: 18 },
  data: { color: colors.textSecondary, fontSize: 11, fontFamily: "monospace", marginTop: 4 },
  empty: { color: colors.textSecondary, textAlign: "center", marginTop: 40, paddingHorizontal: 20 },
});
