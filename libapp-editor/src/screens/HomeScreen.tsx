import React, { useState, useCallback } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useFocusEffect } from "@react-navigation/native";
import { colors } from "../theme";
import { searchString, searchHex, base64ToUint8 } from "../utils/binary";
import { SearchResult } from "../types";
import { loadSettings, loadLastAnalyze, LastAnalyzeSummary } from "../store/storage";
import { useAppFile } from "../store/AppContext";
import { soFingerprint } from "../utils/hash";
import DeveloperFooter from "../components/DeveloperFooter";
import { logger } from "../utils/logger";

const PRESETS_QUICK = [
  "isPremium", "isPro", "isSubscribed", "purchased",
  "isUnlocked", "isVip", "hasSubscription",
];

export default function HomeScreen({ navigation }: any) {
  const { buffer, fileName, setFile, backupUri, setBackupUri, abi, readyForApk } = useAppFile();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"string" | "hex">("string");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [autoBackup, setAutoBackup] = useState(true);
  const [lastReport, setLastReport] = useState<LastAnalyzeSummary | null>(null);

  useFocusEffect(
    useCallback(() => {
      loadSettings()
        .then((s) => setAutoBackup(s.autoBackup))
        .catch(() => {});
      loadLastAnalyze()
        .then(setLastReport)
        .catch(() => setLastReport(null));
    }, [])
  );

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;

      const asset = res.assets[0];
      setLoading(true);
      setLoadingMsg("Проверка размера...");

      // Защита от слишком больших файлов (OOM)
      try {
        const info = await FileSystem.getInfoAsync(asset.uri, { size: true });
        // @ts-ignore
        const size = info.exists && info.size ? info.size : 0;
        if (size > 80 * 1024 * 1024) {
          setLoading(false);
          setLoadingMsg("");
          Alert.alert(
            "Файл слишком большой",
            `${(size / 1024 / 1024).toFixed(1)} MB\n\nТелефон может не справиться с загрузкой в память.\nРекомендуется файл < 50–60 MB.`
          );
          return;
        }
      } catch {
        // ignore size check errors
      }

      setLoadingMsg("Чтение файла...");
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64" });
      setLoadingMsg("Декодирование...");
      const bytes = base64ToUint8(base64);
      logger.info("Home", "file opened", { name: asset.name, size: bytes.length });
      setFile(bytes, asset.name, asset.uri);

      if (autoBackup) {
        setLoadingMsg("Автобэкап...");
        const bakUri = (FileSystem.cacheDirectory || "") + asset.name + ".bak";
        await FileSystem.writeAsStringAsync(bakUri, base64, { encoding: "base64" });
        setBackupUri(bakUri);
        logger.info("Home", "backup saved", { bakUri });
      }

      setLoading(false);
      setLoadingMsg("");
    } catch (e: any) {
      setLoading(false);
      setLoadingMsg("");
      Alert.alert("Ошибка", e.message || "Не удалось открыть файл");
    }
  };

  const doSearch = (customQuery?: string) => {
    const q = (customQuery ?? query).trim();
    if (!buffer) {
      Alert.alert("Файл не выбран", "Сначала выбери libapp.so");
      return;
    }
    if (!q) {
      Alert.alert("Пустой запрос", "Введи строку или hex");
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

        navigation.navigate("Results", {
          results,
          buffer,
          fileName,
          query: q,
        });
      } catch (e: any) {
        setLoading(false);
        setLoadingMsg("");
        Alert.alert("Ошибка поиска", e.message);
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
              onPress={() => navigation.navigate("Analyze")}
            >
              <Text style={styles.quickText} selectable>Analyze</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => navigation.navigate("ImportDump")}
            >
              <Text style={styles.quickText} selectable>Import</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.quickBtn}
              onPress={() => navigation.navigate("Compare")}
            >
              <Text style={styles.quickText} selectable>Diff</Text>
            </TouchableOpacity>
          </View>
        )}

        {lastReport && (
          <TouchableOpacity
            style={styles.lastCard}
            onPress={() => navigation.navigate("Analyze")}
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

        <View style={styles.workflow}>
          <Text style={styles.sectionTitle} selectable>Порядок работы</Text>
          <Text style={styles.workflowHint} selectable>
            Снизу в меню те же шаги: Файл → Анализ → Патч → APK
          </Text>

          <TouchableOpacity
            style={[styles.stepBtn, styles.stepPrimary]}
            onPress={() => navigation.navigate("AnalyzeTab")}
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
            onPress={() => navigation.navigate("PatchTab")}
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
            onPress={() => navigation.navigate("ApkTab")}
          >
            <Text style={[styles.stepNum, styles.stepNumMuted]} selectable>4</Text>
            <View style={styles.stepBody}>
              <Text style={[styles.stepTitle, { color: colors.gold }]} selectable>APK</Text>
              <Text style={styles.stepDesc} selectable>Достать libapp.so / вставить патченый обратно.</Text>
            </View>
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { marginTop: 22 }]} selectable>Дополнительно</Text>
          <View style={styles.extraRow}>
            <TouchableOpacity style={styles.extraBtn} onPress={() => navigation.navigate("ImportDump")}>
              <Text style={styles.extraText} selectable>Import dump</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.extraBtn} onPress={() => navigation.navigate("AutoUnlock")}>
              <Text style={styles.extraText} selectable>Auto Unlock</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.extraRow}>
            <TouchableOpacity style={styles.extraBtn} onPress={() => navigation.navigate("PremiumScan")}>
              <Text style={styles.extraText} selectable>PRO-скан</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.extraBtn} onPress={() => navigation.navigate("Compare")}>
              <Text style={styles.extraText} selectable>Сравнить</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.extraBtn} onPress={() => navigation.navigate("Help")}>
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
  stepPrimary: { borderColor: colors.gold, backgroundColor: "#1a1810" },
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
