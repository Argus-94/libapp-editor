import React, { useState, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { colors } from "../theme";
import { useDialog } from "../components/DialogProvider";
import { searchString, searchHex } from "../utils/binary";
import { SearchResult } from "../types";
import { loadLastAnalyze, loadSessionMeta, LastAnalyzeSummary, SessionMeta } from "../store/storage";
import { useAppFile } from "../store/AppContext";
import { soFingerprint } from "../utils/hash";
import DeveloperFooter from "../components/DeveloperFooter";
import { logger } from "../utils/logger";
import { openLibappFile } from "../utils/openLibapp";
import { navigateRoot, navigateTab } from "../utils/nav";

const PRESETS_QUICK = [
  "isPremium", "isPro", "isSubscribed", "purchased",
  "isUnlocked", "isVip", "hasSubscription",
];

export default function HomeScreen({ navigation }: any) {
  const dialog = useDialog();
  const { buffer, fileName, setFile, backupUri, setBackupUri, abi, readyForApk, dirty, fingerprint, patchQueue, revertToOriginal } = useAppFile();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"string" | "hex">("string");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [lastReport, setLastReport] = useState<LastAnalyzeSummary | null>(null);
  const [session, setSession] = useState<SessionMeta | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadLastAnalyze()
        .then(setLastReport)
        .catch(() => setLastReport(null));
      loadSessionMeta()
        .then(setSession)
        .catch(() => setSession(null));
    }, [])
  );

  const pickFile = async () => {
    setLoading(true);
    setLoadingMsg("Открытие файла...");
    try {
      const r = await openLibappFile();
      if (!r.ok) {
        if (r.error !== "cancelled") dialog.alert("Файл", r.error);
        return;
      }
      setFile(r.buffer, r.name, r.uri, { backupUri: r.backupUri });
      if (r.backupUri) setBackupUri(r.backupUri);
      logger.info("Home", "file opened", { name: r.name, size: r.buffer.length });
    } catch (e: any) {
      dialog.alert("Ошибка", e.message || "Не удалось открыть файл");
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  };

  const doSearch = (customQuery?: string) => {
    const q = (customQuery ?? query).trim();
    if (!buffer) {
      dialog.alert("Файл не выбран", "Сначала выбери libapp.so");
      return;
    }
    if (!q) {
      dialog.alert("Пустой запрос", "Введи строку или hex");
      return;
    }

    setLoading(true);
    setLoadingMsg("Поиск...");

    setTimeout(() => {
      try {
        const results: SearchResult[] =
          mode === "string" ? searchString(buffer, q, true) : searchHex(buffer, q);

        setLoading(false);
        setLoadingMsg("");

        // buffer already in AppContext — do not pass Uint8Array via navigation params
        navigateRoot(navigation, "Results", {
          results,
          fileName,
          query: q,
        });
      } catch (e: any) {
        setLoading(false);
        setLoadingMsg("");
        dialog.alert("Ошибка поиска", e.message);
      }
    }, 30);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} selectable>1. Файл</Text>
        <Text style={styles.subtitle} selectable>Открой libapp.so → при необходимости найди строку. Дальше — вкладка Анализ.</Text>

        <TouchableOpacity style={styles.fileBtn} onPress={pickFile} disabled={loading} activeOpacity={0.85}>
          <Text style={styles.fileBtnText} selectable>
            {fileName ? `📁  ${fileName}` : "Выбрать libapp.so"}
          </Text>
        </TouchableOpacity>

        {buffer && !loading && (
          <Text style={styles.info} selectable>
            Размер: {(buffer.length / 1024 / 1024).toFixed(2)} MB · fp {soFingerprint(buffer)}
            {abi ? ` · ${abi}` : ""}
            {readyForApk ? " · готов к APK" : ""}
          </Text>
        )}

        {buffer && !loading && (
          <View style={styles.quickRow}>
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => navigateTab(navigation, "AnalyzeTab")}
            >
              <Text style={styles.quickText} selectable>Analyze</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => navigateRoot(navigation, "ImportDump")}
            >
              <Text style={styles.quickText} selectable>Import</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => navigateRoot(navigation, "Compare")}
            >
              <Text style={styles.quickText} selectable>Diff</Text>
            </TouchableOpacity>
          </View>
        )}

        {lastReport && (
          <TouchableOpacity
            style={styles.lastCard}
            onPress={() => navigateTab(navigation, "AnalyzeTab")}
            activeOpacity={0.85}
          >
            <Text style={styles.lastTitle} selectable>Последний Analyze</Text>
            <Text style={styles.lastBody} selectable>
              {lastReport.fileName} · risk {lastReport.riskLevel} ({lastReport.riskScore})
              {"\n"}imm_ret {lastReport.immRet} · near12 {lastReport.nearRet12} · fp {lastReport.fingerprint}
              {lastReport.topKeys?.length
                ? `\n${lastReport.topKeys.slice(0, 4).join(", ")}`
                : ""}
            </Text>
          </TouchableOpacity>
        )}

        {loading && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.gold} size="small" />
            <Text style={styles.loadingText} selectable>{loadingMsg}</Text>
          </View>
        )}

        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === "string" && styles.modeActive]}
            onPress={() => setMode("string")}
          >
            <Text style={[styles.modeText, mode === "string" && styles.modeTextActive]} selectable>Строка</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === "hex" && styles.modeActive]}
            onPress={() => setMode("hex")}
          >
            <Text style={[styles.modeText, mode === "hex" && styles.modeTextActive]} selectable>HEX</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          placeholder={mode === "string" ? "isPremium / isPro..." : "00 00 80 52"}
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!loading}
        />

        <TouchableOpacity
          style={[styles.searchBtn, loading && { opacity: 0.6 }]}
          onPress={() => doSearch()}
          disabled={loading}
        >
          <Text style={styles.searchBtnText} selectable>Найти</Text>
        </TouchableOpacity>

        <View style={styles.presets}>
          <Text style={styles.sectionTitle} selectable>Быстрый поиск</Text>
          <View style={styles.presetRow}>
            {PRESETS_QUICK.map((p) => (
              <TouchableOpacity
                key={p}
                style={styles.presetChip}
                onPress={() => { setMode("string"); setQuery(p); doSearch(p); }}
                disabled={loading || !buffer}
              >
                <Text style={styles.presetText} selectable>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {(dirty || patchQueue.length > 0 || session) && (
          <View style={styles.sessionCard}>
            <Text style={styles.sessionTitle} selectable>Сессия</Text>
            <Text style={styles.sessionBody} selectable>
              {buffer ? fileName || "so в памяти" : "файл не открыт"}
              {dirty ? " · dirty" : ""}
              {fingerprint ? ` · fp ${fingerprint.slice(0, 8)}…` : ""}
              {patchQueue.length ? ` · очередь ${patchQueue.length}` : ""}
              {session?.lastRisk ? ` · last risk ${session.lastRisk}` : ""}
            </Text>
            {patchQueue.length > 0 && (
              <TouchableOpacity onPress={() => navigateRoot(navigation, "Queue")}>
                <Text style={{ color: colors.gold, fontWeight: "700", marginTop: 8 }} selectable>
                  Открыть очередь →
                </Text>
              </TouchableOpacity>
            )}
            {dirty && (
              <TouchableOpacity
                onPress={() => {
                  if (revertToOriginal()) dialog.alert("Откат", "Buffer = original");
                  else dialog.alert("Нет original", "Открой so ещё раз");
                }}
              >
                <Text style={{ color: colors.danger, fontWeight: "700", marginTop: 8 }} selectable>
                  Откат к original
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.workflow}>
          <Text style={styles.sectionTitle} selectable>Порядок работы</Text>
          <Text style={styles.workflowHint} selectable>
            Снизу в меню те же шаги: Файл → Анализ → Патч → APK
          </Text>

          <TouchableOpacity
            style={[styles.stepBtn, styles.stepPrimary]}
            onPress={() => navigateTab(navigation, "AnalyzeTab")}
            disabled={!buffer}
          >
            <Text style={styles.stepNum} selectable>2</Text>
            <View style={styles.stepBody}>
              <Text style={styles.stepTitle} selectable>Анализ</Text>
              <Text style={styles.stepDesc} selectable>Risk, Code candidates, PRO-строки. Сначала сюда.</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => navigateTab(navigation, "PatchTab")}
            disabled={!buffer}
          >
            <Text style={[styles.stepNum, styles.stepNumMuted]} selectable>3</Text>
            <View style={styles.stepBody}>
              <Text style={[styles.stepTitle, { color: colors.gold }]} selectable>Патч</Text>
              <Text style={styles.stepDesc} selectable>Manual по offset из Code candidates (не по строкам isPro).</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.stepBtn}
            onPress={() => navigateTab(navigation, "ApkTab")}
          >
            <Text style={[styles.stepNum, styles.stepNumMuted]} selectable>4</Text>
            <View style={styles.stepBody}>
              <Text style={[styles.stepTitle, { color: colors.gold }]} selectable>APK</Text>
              <Text style={styles.stepDesc} selectable>Достать libapp.so / вставить патченый обратно.</Text>
            </View>
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { marginTop: 22 }]} selectable>Дополнительно</Text>
          <View style={styles.extraRow}>
            <TouchableOpacity style={styles.extraBtn} onPress={() => navigateRoot(navigation, "ImportDump")}>
              <Text style={styles.extraText} selectable>Import dump</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.extraBtn} onPress={() => navigateRoot(navigation, "AutoUnlock")}>
              <Text style={styles.extraText} selectable>Auto Unlock</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.extraRow}>
            <TouchableOpacity style={styles.extraBtn} onPress={() => navigateRoot(navigation, "PremiumScan")}>
              <Text style={styles.extraText} selectable>PRO-скан</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.extraBtn} onPress={() => navigateRoot(navigation, "Compare")}>
              <Text style={styles.extraText} selectable>Сравнить</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.extraBtn} onPress={() => navigateRoot(navigation, "Help")}>
              <Text style={styles.extraText} selectable>Справка</Text>
            </TouchableOpacity>
          </View>
        </View>

        <DeveloperFooter />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40 },
  title: { color: colors.gold, fontSize: 30, fontWeight: "800", marginTop: 8 },
  subtitle: { color: colors.textSecondary, fontSize: 15, marginBottom: 24 },
  fileBtn: {
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.gold,
    borderRadius: 14, padding: 18, marginBottom: 10,
  },
  fileBtnText: { color: colors.gold, fontWeight: "700", textAlign: "center", fontSize: 16 },
  info: { color: colors.textSecondary, textAlign: "center", marginBottom: 16, fontSize: 13 },
  loadingBox: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 16 },
  loadingText: { color: colors.gold, fontSize: 14 },
  modeRow: { flexDirection: "row", marginBottom: 14, gap: 10 },
  modeBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.surface,
    alignItems: "center", borderWidth: 1, borderColor: colors.border,
  },
  modeActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  modeText: { color: colors.textSecondary, fontWeight: "700", fontSize: 15 },
  modeTextActive: { color: colors.onGold },
  input: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 16, color: colors.text,
    fontSize: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border,
  },
  searchBtn: { backgroundColor: colors.gold, borderRadius: 14, padding: 17, alignItems: "center" },
  searchBtnText: { color: colors.onGold, fontWeight: "800", fontSize: 17 },
  presets: { marginTop: 32 },
  sectionTitle: { color: colors.gold, fontWeight: "700", fontSize: 16, marginBottom: 12 },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetChip: {
    backgroundColor: colors.surfaceLight, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: colors.border,
  },
  presetText: { color: colors.text, fontSize: 13, fontWeight: "500" },
  quickNav: { flexDirection: "row", gap: 12, marginTop: 28 },
  navBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border, alignItems: "center",
  },
  navBtnText: { color: colors.gold, fontWeight: "600" },
  premiumScanBtn: {
    marginTop: 20,
    backgroundColor: colors.gold,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
  },
  premiumScanText: { color: colors.onGold, fontWeight: "800", fontSize: 16 },
  footer: { marginTop: 36, alignItems: "center", paddingBottom: 12 },
  footerLine: { color: colors.textSecondary, fontSize: 12 },
  footerDev: { color: colors.gold, fontSize: 13, marginTop: 4, fontWeight: "600" },
  quickRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  quickBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 10,
    alignItems: "center", borderWidth: 1, borderColor: colors.border,
  },
  quickText: { color: colors.gold, fontWeight: "700", fontSize: 13 },
  lastCard: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  lastTitle: { color: colors.gold, fontWeight: "700", fontSize: 13, marginBottom: 4 },
  lastBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontFamily: "monospace" },
  sessionCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderGold,
  },
  sessionTitle: { color: colors.gold, fontWeight: "800", fontSize: 13, marginBottom: 4 },
  sessionBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontFamily: "monospace" },
  workflow: { marginTop: 28, marginBottom: 8 },
  workflowHint: { color: colors.textSecondary, fontSize: 12, marginBottom: 14, lineHeight: 18 },
  stepBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepPrimary: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  stepNum: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.gold,
    color: colors.onGold, fontWeight: "900", fontSize: 16, textAlign: "center", lineHeight: 32, marginRight: 12,
  },
  stepNumMuted: { backgroundColor: colors.surfaceLight, color: colors.gold },
  stepBody: { flex: 1 },
  stepTitle: { color: colors.gold, fontWeight: "800", fontSize: 16 },
  stepDesc: { color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 17 },
  extraRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  extraBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 12,
    alignItems: "center", borderWidth: 1, borderColor: colors.border,
  },
  extraText: { color: colors.gold, fontWeight: "600", fontSize: 12 },
});
