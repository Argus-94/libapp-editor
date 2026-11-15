import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Alert, ActivityIndicator,
  ScrollView,
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

type Tab = "offsets" | "dump";

export default function ImportDumpScreen({ navigation }: any) {
  const { buffer, fileName } = useAppFile();
  const [tab, setTab] = useState<Tab>("offsets");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [offsets, setOffsets] = useState<ImportedOffset[]>([]);
  const [dump, setDump] = useState<DumpParseResult | null>(null);
  const [oobCount, setOobCount] = useState(0);

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
      Alert.alert("Ошибка", e.message || String(e));
    }
  };

  const runParse = () => {
    if (!text.trim()) {
      Alert.alert("Пусто", "Вставь текст или выбери файл");
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
            logger.info("Import", "offsets parsed", { ok: ok.length, oob: oob.length });
          } else {
            setOffsets(all);
            setOobCount(0);
            logger.info("Import", "offsets parsed (no so)", { n: all.length });
          }
          setDump(null);
          if (all.length === 0) Alert.alert("Пусто", "Offset не найдены");
        } else {
          const r = parseOfflineDump(text, buffer);
          setDump(r);
          setOffsets(r.offsets);
          setOobCount(0);
          logger.info("Import", "dump parsed", r.stats);
          if (r.notes.length) {
            Alert.alert("Заметки", r.notes.join("\n"));
          }
        }
      } catch (e: any) {
        logger.error("Import", "parse failed", e?.message);
        Alert.alert("Ошибка", e.message || String(e));
      } finally {
        setLoading(false);
      }
    }, 30);
  };

  const openManual = (offset: number) => {
    if (!buffer) {
      Alert.alert("Нет so", "Сначала открой libapp.so на вкладке Поиск");
      return;
    }
    if (offset + 4 > buffer.length) {
      Alert.alert("Вне файла", `0x${offset.toString(16)} за пределами so`);
      return;
    }
    logger.info("Import", "open Manual", { offset });
    navigation.navigate("ManualPatch", { initialOffset: offset });
  };

  const preview = (offset: number) => {
    if (!buffer) return;
    const lines = disasmAt(buffer, offset, 8);
    Alert.alert(
      "Disasm " + ("0x" + offset.toString(16)),
      lines.map((l) => `${l.hexOffset}  ${l.hex}  ${l.asm}`).join("\n") || "пусто"
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 20 }}>
        <Text style={styles.title} selectable>Импорт offset / dump</Text>
        <Text style={styles.sub} selectable>
          Тяжёлый режим: список адресов из r2 / R2Droid или текстовый dump с ПК (Blutter export).
          {"\n"}so: {buffer ? `${fileName || "loaded"} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)` : "не открыт"}
        </Text>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, tab === "offsets" && styles.tabOn]}
            onPress={() => setTab("offsets")}
          >
            <Text style={[styles.tabText, tab === "offsets" && styles.tabTextOn]} selectable>Offset list</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === "dump" && styles.tabOn]}
            onPress={() => setTab("dump")}
          >
            <Text style={[styles.tabText, tab === "dump" && styles.tabTextOn]} selectable>Offline dump</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.hint} selectable>
          {tab === "offsets"
            ? "Форматы: 0x4C4A64, JSON [{\"offset\":\"0x...\",\"note\":\"ownsPro\"}], строки r2"
            : "Вставь текст Blutter / strings / заметки. При открытом so — сопоставление имён в бинаре."}
        </Text>

        <TextInput
          style={styles.input}
          multiline
          value={text}
          onChangeText={setText}
          placeholder={tab === "offsets" ? "0x0012AB00 ownsPro\n0x0012AC00" : "[pp+0x..] : \"ownsPro\" ..."}
          placeholderTextColor={colors.textSecondary}
          textAlignVertical="top"
        />

        <View style={styles.row}>
          <TouchableOpacity style={styles.btnOutline} onPress={loadFile}>
            <Text style={styles.btnOutlineText} selectable>Файл</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnGold} onPress={runParse} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.onGold} /> : <Text style={styles.btnGoldText} selectable>Парсить</Text>}
          </TouchableOpacity>
        </View>

        {tab === "offsets" && offsets.length > 0 && (
          <Text style={styles.stats} selectable>
            Offset: {offsets.length}
            {oobCount ? ` · вне файла: ${oobCount}` : ""}
          </Text>
        )}

        {dump && (
          <View style={styles.card}>
            <Text style={styles.cardTitle} selectable>Dump stats</Text>
            <Text style={styles.mono} selectable>
              lines {dump.stats.lines} · symbols {dump.stats.symbolHits} · offsets {dump.stats.offsetHits}
              {"\n"}so matches {dump.stats.soMatches}
            </Text>
          </View>
        )}
      </ScrollView>

      {tab === "offsets" && (
        <FlatList
          data={offsets}
          keyExtractor={(item) => item.hexOffset}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14, paddingTop: 0, paddingBottom: 40 }}
          ListHeaderComponent={
            offsets.length ? <Text style={styles.listTitle} selectable>Offsets → Manual</Text> : null
          }
          renderItem={({ item }) => (
            <View style={styles.item}>
              <Text style={styles.off} selectable>{item.hexOffset}</Text>
              <Text style={styles.note} numberOfLines={2} selectable>
                {item.note || item.source}
              </Text>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => preview(item.offset)}>
                  <Text style={styles.actionText} selectable>Disasm</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPrimary]}
                  onPress={() => openManual(item.offset)}
                >
                  <Text style={styles.actionTextPrimary} selectable>Manual</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => copyText("offset", item.hexOffset)}>
                  <Text style={styles.actionText} selectable>Copy</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListFooterComponent={<DeveloperFooter />}
        />
      )}

      {tab === "dump" && dump && (
        <FlatList
          data={[
            ...dump.matchedInSo.map((m) => ({
              kind: "so" as const,
              title: m.name,
              hex: m.hexOffset,
              offset: m.soOffset,
              meta: `${m.category} · w${m.weight}`,
            })),
            ...dump.symbols
              .filter((s) => s.offset !== null)
              .slice(0, 40)
              .map((s) => ({
                kind: "sym" as const,
                title: s.name,
                hex: s.hexOffset || "",
                offset: s.offset!,
                meta: s.category,
              })),
          ]}
          keyExtractor={(item, i) => item.kind + item.hex + item.title + i}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
          ListHeaderComponent={
            <Text style={styles.listTitle} selectable>
              Совпадения в so (сверху) + символы dump с offset
            </Text>
          }
          renderItem={({ item }) => (
            <View style={[styles.item, item.kind === "so" && styles.itemHot]}>
              <Text style={styles.off} selectable>
                {item.hex} · {item.title}
              </Text>
              <Text style={styles.note} selectable>{item.meta}</Text>
              <View style={styles.actions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => preview(item.offset)}>
                  <Text style={styles.actionText} selectable>Disasm</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnPrimary]}
                  onPress={() => openManual(item.offset)}
                >
                  <Text style={styles.actionTextPrimary} selectable>Manual</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => copyText("offset", item.hex)}>
                  <Text style={styles.actionText} selectable>Copy</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          ListFooterComponent={<DeveloperFooter />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { color: colors.gold, fontSize: 20, fontWeight: "800" },
  sub: { color: colors.textSecondary, marginTop: 6, marginBottom: 12, lineHeight: 18, fontSize: 13 },
  tabs: { flexDirection: "row", gap: 8, marginBottom: 10 },
  tab: {
    flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", minHeight: 48, justifyContent: "center",
  },
  tabOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  tabText: { color: colors.textSecondary, fontWeight: "700" },
  tabTextOn: { color: colors.onGold },
  hint: { color: colors.textSecondary, fontSize: 12, marginBottom: 8, lineHeight: 16 },
  input: {
    minHeight: 120, maxHeight: 180, backgroundColor: colors.surface, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border, color: colors.text, padding: 10,
    fontFamily: "monospace", fontSize: 12,
  },
  row: { flexDirection: "row", gap: 8, marginTop: 10 },
  btnGold: {
    flex: 1, backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 14, alignItems: "center", minHeight: 48, justifyContent: "center",
  },
  btnGoldText: { color: colors.onGold, fontWeight: "800", fontSize: 15 },
  btnOutline: {
    flex: 1, borderWidth: 1.5, borderColor: colors.borderGold, borderRadius: 12, paddingVertical: 14, alignItems: "center", minHeight: 48, justifyContent: "center",
  },
  btnOutlineText: { color: colors.gold, fontWeight: "700", fontSize: 15 },
  stats: { color: colors.text, marginTop: 10, fontWeight: "600" },
  card: {
    marginTop: 10, backgroundColor: colors.surface, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  cardTitle: { color: colors.gold, fontWeight: "700", marginBottom: 4 },
  mono: { color: colors.textSecondary, fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
  listTitle: { color: colors.gold, fontWeight: "700", marginBottom: 8 },
  item: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
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
  note: { color: colors.textSecondary, fontSize: 13, marginTop: 6, marginBottom: 12 },
  actions: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderGold,
  },
  actionBtnPrimary: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  actionText: { color: colors.gold, fontWeight: "800", fontSize: 14 },
  actionTextPrimary: { color: colors.onGold, fontWeight: "800", fontSize: 14 },
});
