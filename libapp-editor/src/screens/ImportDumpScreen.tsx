import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  ActivityIndicator,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { colors } from "../theme";
import { useAppFile } from "../store/AppContext";
import { parseOffsetList, filterOffsetsInRange, ImportedOffset } from "../utils/offsetImport";
import { parseOfflineDump, DumpParseResult } from "../utils/dumpParse";
import { disasmAt } from "../utils/analyze";
import { copyText } from "../utils/copyText";
import { logger } from "../utils/logger";
import DeveloperFooter from "../components/DeveloperFooter";
import AppModal from "../components/AppModal";
import { navigatePatch } from "../utils/nav";

type Tab = "offsets" | "dump";

type ListRow =
  | { kind: "off"; offset: number; hex: string; note: string }
  | { kind: "so"; offset: number; hex: string; title: string; meta: string }
  | { kind: "sym"; offset: number; hex: string; title: string; meta: string };

export default function ImportDumpScreen({ navigation }: any) {
  const { buffer, fileName } = useAppFile();
  const [tab, setTab] = useState<Tab>("offsets");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [offsets, setOffsets] = useState<ImportedOffset[]>([]);
  const [dump, setDump] = useState<DumpParseResult | null>(null);
  const [oobCount, setOobCount] = useState(0);
  const [dialog, setDialog] = useState<{
    title: string;
    message: string;
    mono?: boolean;
  } | null>(null);

  const show = (title: string, message: string, mono = false) =>
    setDialog({ title, message, mono });

  const loadFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ["text/plain", "application/json", "*/*"],
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const uri = res.assets[0].uri;
      const content = await FileSystem.readAsStringAsync(uri, { encoding: "utf8" });
      setText(content.slice(0, 500_000));
      logger.info("Import", "file loaded", { name: res.assets[0].name, len: content.length });
    } catch (e: any) {
      logger.error("Import", "file load failed", e?.message);
      show("Ошибка", e.message || String(e));
    }
  };

  const runParse = () => {
    if (!text.trim()) {
      show("Пусто", "Вставь текст или выбери файл");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      try {
        if (tab === "offsets") {
          const all = parseOffsetList(text);
          if (buffer) {
            const { ok, oob } = filterOffsetsInRange(all, buffer.length);
            setOffsets(ok);
            setOobCount(oob.length);
          } else {
            setOffsets(all);
            setOobCount(0);
          }
          setDump(null);
          if (all.length === 0) show("Пусто", "Offset не найдены");
        } else {
          const r = parseOfflineDump(text, buffer || undefined);
          setDump(r);
          setOffsets([]);
          if (r.notes?.length) show("Заметки", r.notes.join("\n"));
        }
      } catch (e: any) {
        show("Ошибка", e.message || String(e));
      } finally {
        setLoading(false);
      }
    }, 30);
  };

  const openManual = (offset: number) => {
    if (!buffer) {
      show("Нет so", "Сначала открой libapp.so на вкладке Файл");
      return;
    }
    navigatePatch(navigation, offset);
  };

  const preview = (offset: number) => {
    if (!buffer) {
      show("Нет so", "Сначала открой libapp.so");
      return;
    }
    const lines = disasmAt(buffer, offset, 14);
    const body =
      lines.map((l) => `${l.hexOffset}  ${l.hex}  ${l.asm}`).join("\n") || "пусто";
    show("Disasm " + ("0x" + offset.toString(16)), body, true);
  };

  const listData: ListRow[] = useMemo(() => {
    if (tab === "offsets") {
      return offsets.map((o) => ({
        kind: "off" as const,
        offset: o.offset,
        hex: o.hexOffset,
        note: o.note || o.source || "",
      }));
    }
    if (!dump) return [];
    const so = dump.matchedInSo.map((m) => ({
      kind: "so" as const,
      offset: m.soOffset,
      hex: m.hexOffset,
      title: m.name,
      meta: `${m.category} · w${m.weight}`,
    }));
    const sym = dump.symbols
      .filter((s) => s.offset !== null)
      .slice(0, 60)
      .map((s) => ({
        kind: "sym" as const,
        offset: s.offset!,
        hex: s.hexOffset || "",
        title: s.name,
        meta: s.category,
      }));
    return [...so, ...sym];
  }, [tab, offsets, dump]);

  const header = (
    <View style={styles.header}>
      <Text style={styles.title} selectable>
        Импорт offset / dump
      </Text>
      <Text style={styles.sub} selectable>
        Список адресов из r2 / R2Droid или dump с ПК (Blutter).{"\n"}
        so:{" "}
        {buffer
          ? `${fileName || "loaded"} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`
          : "не открыт"}
      </Text>

      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === "offsets" && styles.tabOn]}
          onPress={() => setTab("offsets")}
        >
          <Text style={[styles.tabText, tab === "offsets" && styles.tabTextOn]} selectable>
            Offset list
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "dump" && styles.tabOn]}
          onPress={() => setTab("dump")}
        >
          <Text style={[styles.tabText, tab === "dump" && styles.tabTextOn]} selectable>
            Offline dump
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.hint} selectable>
        {tab === "offsets"
          ? 'Форматы: 0x4C4A64, JSON [{"offset":"0x...","note":"ownsPro"}], строки r2'
          : "Вставь текст Blutter / strings / заметки. При открытом so — сопоставление имён."}
      </Text>

      <TextInput
        style={styles.input}
        multiline
        value={text}
        onChangeText={setText}
        placeholder={
          tab === "offsets" ? "0x0012AB00 ownsPro\n0x0012AC00" : '[pp+0x..] : "ownsPro" ...'
        }
        placeholderTextColor={colors.textSecondary}
        textAlignVertical="top"
      />

      <View style={styles.row}>
        <TouchableOpacity style={styles.btnOutline} onPress={loadFile}>
          <Text style={styles.btnOutlineText} selectable>
            Файл
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnGold} onPress={runParse} disabled={loading}>
          {loading ? (
            <ActivityIndicator color={colors.onGold} />
          ) : (
            <Text style={styles.btnGoldText} selectable>
              Парсить
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {tab === "offsets" && offsets.length > 0 && (
        <Text style={styles.stats} selectable>
          Offset: {offsets.length}
          {oobCount ? ` · вне файла: ${oobCount}` : ""}
        </Text>
      )}

      {dump && (
        <View style={styles.statsCard}>
          <Text style={styles.cardTitle} selectable>
            Dump stats
          </Text>
          <Text style={styles.mono} selectable>
            lines {dump.stats.lines} · symbols {dump.stats.symbolHits} · offsets{" "}
            {dump.stats.offsetHits}
            {"\n"}so matches {dump.stats.soMatches}
          </Text>
        </View>
      )}

      {listData.length > 0 && (
        <Text style={styles.listTitle} selectable>
          Результаты · {listData.length}
        </Text>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={listData}
        keyExtractor={(item, i) => item.kind + item.hex + i}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty} selectable>
              После «Парсить» результаты появятся здесь. Можно прокручивать весь экран.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={[styles.item, item.kind === "so" && styles.itemHot]}>
            <Text style={styles.off} selectable>
              {item.hex}
              {"title" in item && item.title ? `  ·  ${item.title}` : ""}
            </Text>
            <Text style={styles.note} numberOfLines={4} selectable>
              {"note" in item ? item.note : "meta" in item ? item.meta : ""}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => preview(item.offset)}>
                <Text style={styles.actionText} selectable>
                  Disasm
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnPrimary]}
                onPress={() => openManual(item.offset)}
              >
                <Text style={styles.actionTextPrimary} selectable>
                  Manual
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => copyText("offset", item.hex)}
              >
                <Text style={styles.actionText} selectable>
                  Copy
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListFooterComponent={<DeveloperFooter />}
      />

      <AppModal
        visible={!!dialog}
        title={dialog?.title || ""}
        message={dialog?.mono ? undefined : dialog?.message}
        onClose={() => setDialog(null)}
        actions={[{ label: "OK", onPress: () => setDialog(null) }]}
      >
        {dialog?.mono ? (
          <Text
            selectable
            style={{
              color: colors.text,
              fontFamily: "monospace",
              fontSize: 12,
              lineHeight: 18,
              marginBottom: 4,
            }}
          >
            {dialog.message}
          </Text>
        ) : null}
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  listContent: { paddingBottom: 48 },
  header: { padding: 16, paddingBottom: 8 },
  title: { color: colors.goldLight, fontSize: 20, fontWeight: "800" },
  sub: { color: colors.textSecondary, marginTop: 6, marginBottom: 14, lineHeight: 19, fontSize: 13 },
  tabs: { flexDirection: "row", gap: 10, marginBottom: 12 },
  tab: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  tabOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  tabText: { color: colors.textSecondary, fontWeight: "700", fontSize: 14 },
  tabTextOn: { color: colors.onGold },
  hint: { color: colors.textSecondary, fontSize: 12, marginBottom: 10, lineHeight: 17 },
  input: {
    minHeight: 140,
    maxHeight: 200,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    padding: 14,
    fontFamily: "monospace",
    fontSize: 13,
  },
  row: { flexDirection: "row", gap: 10, marginTop: 12 },
  btnGold: {
    flex: 1,
    backgroundColor: colors.gold,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGoldText: { color: colors.onGold, fontWeight: "800", fontSize: 15 },
  btnOutline: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.borderGold,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  btnOutlineText: { color: colors.gold, fontWeight: "700", fontSize: 15 },
  stats: { color: colors.text, marginTop: 14, fontWeight: "700", fontSize: 14 },
  statsCard: {
    marginTop: 14,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.gold, fontWeight: "800", marginBottom: 6, fontSize: 14 },
  mono: { color: colors.textSecondary, fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
  listTitle: {
    color: colors.gold,
    fontWeight: "800",
    fontSize: 15,
    marginTop: 18,
    marginBottom: 4,
  },
  empty: {
    color: colors.textSecondary,
    textAlign: "center",
    padding: 24,
    lineHeight: 20,
    fontSize: 13,
  },
  item: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  itemHot: { borderLeftWidth: 4, borderLeftColor: colors.gold },
  off: {
    color: colors.goldLight,
    fontFamily: "monospace",
    fontWeight: "800",
    fontSize: 15,
  },
  note: { color: colors.textSecondary, fontSize: 13, marginTop: 8, marginBottom: 14, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderGold,
  },
  actionBtnPrimary: { backgroundColor: colors.gold, borderColor: colors.gold },
  actionText: { color: colors.gold, fontWeight: "800", fontSize: 14 },
  actionTextPrimary: { color: colors.onGold, fontWeight: "800", fontSize: 14 },
});
