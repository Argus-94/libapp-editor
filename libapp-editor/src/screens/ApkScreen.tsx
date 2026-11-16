import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, FlatList,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { colors } from "../theme";
import { logger } from "../utils/logger";
import {
  extractLibappFromApk, injectLibappIntoApk, saveAndShare, ExtractedSo, getFileSize,
} from "../utils/apk";
import { findAll } from "../utils/binary";
import { deepUnlock } from "../utils/unlock";
import { addHistoryRecord } from "../store/storage";
import { useAppFile } from "../store/AppContext";
import { useDialog } from "../components/DialogProvider";
import AppModal from "../components/AppModal";
import { navigateRoot, navigatePatch, navigateTab } from "../utils/nav";

export default function ApkScreen({ navigation }: any) {
  const dialog = useDialog();
  const { setFile, buffer, fileName, readyForApk, setReadyForApk, setAbi, updateBuffer, abi, dirty } = useAppFile();
  const [apkName, setApkName] = useState("");
  const [apkUri, setApkUri] = useState<string | null>(null);
  const [libs, setLibs] = useState<ExtractedSo[]>([]);
  const [selected, setSelected] = useState<ExtractedSo | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [patchedMap, setPatchedMap] = useState<Record<string, Uint8Array>>({});
  const [errorModal, setErrorModal] = useState<{title:string;message:string}|null>(null);

  const pickApk = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "application/vnd.android.package-archive",
        copyToCacheDirectory: true,
      });
      // fallback if mime filter fails
      if (res.canceled || !res.assets?.[0]) {
        const res2 = await DocumentPicker.getDocumentAsync({
          type: "*/*",
          copyToCacheDirectory: true,
        });
        if (res2.canceled || !res2.assets?.[0]) return;
        await loadApk(res2.assets[0].uri, res2.assets[0].name);
        return;
      }
      await loadApk(res.assets[0].uri, res.assets[0].name);
    } catch (e: any) {
      setErrorModal({ title: "Ошибка", message: e.message || String(e) });
    }
  };

  const loadApk = async (uri: string, name: string) => {
    setLoading(true);
    setMsg("Проверка размера...");
    try {
      const size = await getFileSize(uri);
      if (size > 55 * 1024 * 1024) {
        setLoading(false);
        setMsg("");
        setErrorModal({
          title: "APK слишком большой",
          message:
            `${name}\n${(size / 1024 / 1024).toFixed(1)} MB\n\n` +
            `Телефон не тянет загрузку в память.\n\n` +
            `1. Открой APK как ZIP на ПК\n` +
            `2. Достань lib/arm64-v8a/libapp.so\n` +
            `3. Открой .so во вкладке «Поиск»`,
        });
        return;
      }
      setApkUri(uri);
      setApkName(name);
      setMsg("Извлечение libapp.so...");
      const extracted = await extractLibappFromApk(uri);
      setLibs(extracted);
      logger.info("APK", "extracted", { n: extracted.length, name });
      setPatchedMap({});
      setSelected(null);
      if (extracted.length === 0) {
        dialog.alert("Не найдено", "В APK нет libapp.so (это не Flutter-приложение?)");
      }
    } catch (e: any) {
      setErrorModal({ title: "Ошибка", message: e.message || String(e) });
    } finally {
      setLoading(false);
      setMsg("");
    }
  };

  const openForPatch = (lib: ExtractedSo) => {
    const data = patchedMap[lib.path] || lib.data;
    setSelected(lib);
    setFile(data, `${lib.abi}/libapp.so`, null, { abi: lib.abi });
    setAbi(lib.abi);
    navigateTab(navigation, "AnalyzeTab");
  };

  const openManual = (lib: ExtractedSo) => {
    const data = patchedMap[lib.path] || lib.data;
    setSelected(lib);
    setFile(data, `${lib.abi}/libapp.so`, null, { abi: lib.abi });
    setAbi(lib.abi);
    navigatePatch(navigation);
  };

  const markReady = (lib: ExtractedSo) => {
    if (!buffer) {
      dialog.alert("Нет буфера", "Сначала Analyze/Manual по этому so");
      return;
    }
    setPatchedMap((prev) => ({ ...prev, [lib.path]: buffer }));
    setReadyForApk(true);
    logger.info("APK", "markReady", { path: lib.path, abi: lib.abi });
    setSelected(lib);
    dialog.alert("Готово к сборке", `${lib.abi}\nБуфер редактора → ${lib.path}\nТеперь «Собрать APK».`);
  };

  const quickUnlock = async (lib: ExtractedSo) => {
    dialog.confirm(
      "Быстрый unlock — риск",
      "Эвристика near-bool часто роняет Flutter-приложения.\n\nЛучше: Analyze / Manual.\n\nПродолжить всё равно?",
      async () => {
            setLoading(true);
            setMsg(`Патч ${lib.abi}...`);
            try {
              let buf = new Uint8Array(patchedMap[lib.path] || lib.data);
              const centers: number[] = [];
              const enc = new TextEncoder();
              for (const key of ["isPro", "isPremium", "ownsPro", "purchased", "isSubscribed"]) {
                const pat = enc.encode(key);
                for (const off of findAll(buf, pat, 6)) centers.push(off);
              }
              if (centers.length === 0) {
                centers.push(Math.floor(buf.length * 0.4));
              }
              const result = deepUnlock(buf, centers, true);
              setPatchedMap((prev) => ({ ...prev, [lib.path]: result.buffer }));
              await addHistoryRecord({
                offset: 0,
                hexOffset: "apk-quick",
                oldValue: lib.abi,
                newValue: `x${result.patched}`,
                type: "hex",
                note: "quick unlock (warned)",
                fingerprint: lib.fingerprint || undefined,
              });
              dialog.alert("Готово", `${lib.abi}: ~${result.patched} патчей.\nfp ${lib.fingerprint}\nСобери APK и проверь ЗАПУСК.`);
            } catch (e: any) {
              setErrorModal({ title: "Ошибка", message: e.message || String(e) });
            } finally {
              setLoading(false);
              setMsg("");
            }
      },
      "Всё равно",
      true
    );
  };

  const rebuildApk = async () => {
    if (!apkUri) return;
    // Sync current editor buffer into patchedMap if user edited via Analyze/Manual
    const map = { ...patchedMap };
    if (buffer && selected && fileName.includes(selected.abi)) {
      map[selected.path] = buffer;
      setPatchedMap(map);
    } else if (buffer && libs.length === 1) {
      map[libs[0].path] = buffer;
      setPatchedMap(map);
    }
    const keys = Object.keys(map);
    if (keys.length === 0) {
      dialog.alert(
        "Нет патчей",
        "Открой so через Analyze/Manual, внеси правки, затем собери.\n" +
          "Либо используй «Быстрый unlock» (риск)."
      );
      return;
    }
    setLoading(true);
    setMsg("Сборка APK (STORE .so + strip META-INF)...");
    try {
      const replacements = keys.map((path) => ({
        path,
        data: map[path],
      }));
      const result = await injectLibappIntoApk(apkUri, replacements);
      setMsg("Сохранение...");
      const outName = apkName.replace(/\.apk$/i, "") + "_patched.apk";
      await saveAndShare(result.base64, outName);
      const fpLines = result.report
        .map((r) => `${r.path}\n  ${r.sizeBefore}→${r.sizeAfter}  fp ${r.beforeFp}→${r.afterFp}`)
        .join("\n");
      dialog.alert(
        "APK готов",
        `Подпись META-INF снята (${result.strippedSignatures.length} файлов).\n` +
          `Нужна переподпись (uber-apk-signer / apksigner).\n\n` +
          `Проверка inject:\n${fpLines}`
      );
    } catch (e: any) {
      dialog.alert("Ошибка сборки", e.message);
    } finally {
      setLoading(false);
      setMsg("");
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {dirty ? (
        <View style={{ backgroundColor: colors.warningSurface, padding: 10, borderBottomWidth: 1, borderBottomColor: colors.borderGold }}>
          <Text style={{ color: colors.gold, fontWeight: "700", fontSize: 12 }} selectable>
            so в редакторе изменён (dirty) — inject возьмёт текущий buffer
          </Text>
        </View>
      ) : null}
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.title} selectable>Работа с APK</Text>
      <Text style={styles.sub} selectable>Достать libapp.so → патч → собрать обратно</Text>

      <TouchableOpacity style={styles.mainBtn} onPress={pickApk} disabled={loading}>
        <Text style={styles.mainBtnText} selectable>
          {apkName ? `📦 ${apkName}` : "Выбрать APK"}
        </Text>
      </TouchableOpacity>

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.gold} />
          <Text style={styles.loadingText} selectable>{msg}</Text>
        </View>
      )}

      {libs.length > 0 && (
        <>
          <Text style={styles.section} selectable>Найденные libapp.so</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8, lineHeight: 17 }} selectable>
            Патчь ABI, который реально грузит телефон (обычно arm64-v8a).
            После правок нажми «Готов к APK», затем «Собрать».
            {readyForApk ? " · сейчас: помечен готовым" : ""}
            {abi ? ` · контекст: ${abi}` : ""}
          </Text>
          {libs.map((lib) => {
            const isPatched = !!patchedMap[lib.path];
            return (
              <View key={lib.path} style={styles.card}>
                <Text style={styles.abi} selectable>{lib.abi}</Text>
                <Text style={styles.meta} selectable>
                  {(lib.size / 1024 / 1024).toFixed(2)} MB · fp {lib.fingerprint}
                  {isPatched ? "  ·  патчен" : ""}
                </Text>
                <View style={styles.row}>
                  <TouchableOpacity style={styles.btnGold} onPress={() => openForPatch(lib)}>
                    <Text style={styles.btnGoldText} selectable>Analyze</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnOutline} onPress={() => openManual(lib)}>
                    <Text style={styles.btnOutlineText} selectable>Manual</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[styles.btnOutline, { marginTop: 8 }]}
                  onPress={() => {
                    const data = patchedMap[lib.path] || lib.data;
                    setFile(data, `${lib.abi}/libapp.so`, null);
                    navigateRoot(navigation, "PremiumScan");
                  }}
                >
                  <Text style={styles.btnOutlineText} selectable>Платные функции</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnOutline, { marginTop: 8 }]} onPress={() => markReady(lib)}>
                  <Text style={styles.btnOutlineText} selectable>Готов к APK (текущий буфер)</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnOutline, { marginTop: 8 }]} onPress={() => quickUnlock(lib)}>
                  <Text style={[styles.btnOutlineText, { color: colors.textSecondary }]} selectable>
                    Быстрый unlock (риск)
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}

          <TouchableOpacity
            style={styles.multiBtn}
            onPress={async () => {
              if (libs.length === 0) return;
              dialog.alert(
                "Патч всех ABI?",
                `Будет применён быстрый unlock ко всем ${libs.length} libapp.so`,
                [
                  { text: "Отмена", style: "cancel" },
                  {
                    text: "Патчить все",
                    onPress: async () => {
                      for (const lib of libs) {
                        await quickUnlock(lib);
                      }
                    },
                  },
                ]
              );
            }}
            disabled={loading}
          >
            <Text style={styles.multiText} selectable>Патч всех ABI</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.rebuildBtn, Object.keys(patchedMap).length === 0 && { opacity: 0.5 }]}
            onPress={rebuildApk}
            disabled={loading || Object.keys(patchedMap).length === 0}
          >
            <Text style={styles.rebuildText} selectable>
              Собрать APK ({Object.keys(patchedMap).length} ABI)
            </Text>
          </TouchableOpacity>
        </>
      )}

      <View style={styles.tips}>
        <Text style={styles.tipTitle} selectable>Важно</Text>
        <Text style={styles.tip} selectable>• После сборки APK нужно переподписать</Text>
        <Text style={styles.tip} selectable>• debug: apksigner / uber-apk-signer</Text>
        <Text style={styles.tip} selectable>• «Быстрый unlock» — эвристика, проверяй результат</Text>
      </View>
      
    </ScrollView>
      <AppModal
        visible={!!errorModal}
        title={errorModal?.title || "Ошибка"}
        message={errorModal?.message}
        onClose={() => setErrorModal(null)}
        actions={[{ label: "OK", onPress: () => setErrorModal(null) }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { color: colors.gold, fontSize: 24, fontWeight: "800", marginBottom: 4 },
  sub: { color: colors.textSecondary, marginBottom: 20 },
  mainBtn: {
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.gold,
    borderRadius: 14, padding: 18, marginBottom: 16,
  },
  mainBtnText: { color: colors.gold, fontWeight: "700", textAlign: "center", fontSize: 16 },
  loading: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 },
  loadingText: { color: colors.gold },
  section: { color: colors.gold, fontWeight: "700", fontSize: 16, marginBottom: 12, marginTop: 8 },
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: colors.border,
  },
  abi: { color: colors.text, fontWeight: "700", fontSize: 16 },
  meta: { color: colors.textSecondary, fontSize: 13, marginBottom: 10 },
  row: { flexDirection: "row", gap: 10 },
  btnGold: {
    backgroundColor: colors.gold, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
  },
  btnGoldText: { color: colors.onGold, fontWeight: "700" },
  btnOutline: {
    borderWidth: 1.5, borderColor: colors.gold, paddingHorizontal: 16,
    paddingVertical: 10, borderRadius: 10,
  },
  btnOutlineText: { color: colors.gold, fontWeight: "600" },
  multiBtn: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    alignItems: "center", marginTop: 8, borderWidth: 1.5, borderColor: colors.gold,
  },
  multiText: { color: colors.gold, fontWeight: "700", fontSize: 15 },
  rebuildBtn: {
    backgroundColor: colors.gold, borderRadius: 14, padding: 16,
    alignItems: "center", marginTop: 12, marginBottom: 20,
  },
  rebuildText: { color: colors.onGold, fontWeight: "800", fontSize: 16 },
  tips: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  tipTitle: { color: colors.gold, fontWeight: "700", marginBottom: 8 },
  tip: { color: colors.textSecondary, marginBottom: 4, fontSize: 13 },
});
