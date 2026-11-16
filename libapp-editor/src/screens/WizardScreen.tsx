import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { colors } from "../theme";
import { useAppFile } from "../store/AppContext";
import { openLibappFile } from "../utils/openLibapp";
import { analyzeLibapp } from "../utils/analyze";
import { runCodeSearch, stringsFromReport } from "../domain/codeSearch";
import { CodeCandidate } from "../utils/onDeviceRe";
import { hexToBytes } from "../utils/binary";
import { APP_VERSION } from "../version";
import AppModal from "../components/AppModal";
import DeveloperFooter from "../components/DeveloperFooter";
import { navigateTab, navigateRoot, navigatePatch } from "../utils/nav";

const STEPS = ["Файл", "Анализ", "Кандидат", "Патч", "Готово"];

export default function WizardScreen({ navigation }: any) {
  const {
    buffer,
    fileName,
    setFile,
    setBackupUri,
    updateBuffer,
    setTextRange,
    setLastReport,
    dirty,
  } = useAppFile();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [cands, setCands] = useState<CodeCandidate[]>([]);
  const [picked, setPicked] = useState<CodeCandidate | null>(null);
  const [modal, setModal] = useState<{ title: string; message: string } | null>(null);

  const pickFile = async () => {
    setLoading(true);
    try {
      const r = await openLibappFile();
      if (!r.ok) {
        if (r.error !== "cancelled") setModal({ title: "Файл", message: r.error });
        return;
      }
      setFile(r.buffer, r.name, r.uri, { backupUri: r.backupUri });
      if (r.backupUri) setBackupUri(r.backupUri);
      setStep(1);
    } finally {
      setLoading(false);
    }
  };

  const runAnalyze = () => {
    if (!buffer) {
      setModal({ title: "Нет файла", message: "Сначала шаг 1 — открыть so." });
      return;
    }
    setLoading(true);
    requestAnimationFrame(() => {
      try {
        const report = analyzeLibapp(buffer, fileName || "libapp.so", APP_VERSION);
        setLastReport(report);
        if (report.elf.textRange) setTextRange(report.elf.textRange);
        const { candidates, actionable } = runCodeSearch({
          buffer,
          textRange: report.elf.textRange,
          strings: stringsFromReport(report),
        });
        setCands(actionable.length ? actionable : candidates.slice(0, 15));
        setStep(2);
        setModal({
          title: "Анализ готов",
          message: `Risk ${report.risk.level} · кандидатов ${candidates.length} (сильных ${actionable.length})`,
        });
      } catch (e: any) {
        setModal({ title: "Ошибка", message: e?.message || String(e) });
      } finally {
        setLoading(false);
      }
    });
  };

  const applyPicked = () => {
    if (!buffer || !picked?.patchHex) {
      setModal({ title: "Нет патча", message: "Выбери кандидата с → HEX." });
      return;
    }
    try {
      const bytes = hexToBytes(picked.patchHex.replace(/\s+/g, ""));
      const next = new Uint8Array(buffer);
      next.set(bytes, picked.offset);
      updateBuffer(next);
      setStep(4);
      setModal({
        title: "Патч в памяти",
        message: `${picked.hexOffset}\n${picked.movzHex} → ${picked.patchHex}\n\nСохрани so на вкладке Патч / Результаты и при необходимости inject в APK.`,
      });
    } catch (e: any) {
      setModal({ title: "Ошибка", message: e?.message || String(e) });
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={styles.title} selectable>
        Мастер первого патча
      </Text>
      <Text style={styles.sub} selectable>
        Один безопасный путь: файл → анализ → кандидат в .text → один патч.
      </Text>

      <View style={styles.steps}>
        {STEPS.map((s, i) => (
          <View key={s} style={[styles.stepPill, i === step && styles.stepOn, i < step && styles.stepDone]}>
            <Text style={[styles.stepTxt, (i === step || i < step) && styles.stepTxtOn]} selectable>
              {i + 1}. {s}
            </Text>
          </View>
        ))}
      </View>

      {step === 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle} selectable>
            1. Открой libapp.so
          </Text>
          <Text style={styles.body} selectable>
            Из APK достань so на вкладке APK или открой файл здесь.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={pickFile} disabled={loading}>
            {loading ? (
              <ActivityIndicator color={colors.onGold} />
            ) : (
              <Text style={styles.btnText} selectable>
                {buffer ? `Сменить (${fileName})` : "Открыть libapp.so"}
              </Text>
            )}
          </TouchableOpacity>
          {!!buffer && (
            <TouchableOpacity style={styles.btnOutline} onPress={() => setStep(1)}>
              <Text style={styles.btnOutlineText} selectable>
                Дальше с текущим файлом
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {step === 1 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle} selectable>
            2. Анализ
          </Text>
          <Text style={styles.body} selectable>
            Risk + поиск кода (не строк isPro). Файл: {fileName || "—"}
          </Text>
          <TouchableOpacity style={styles.btn} onPress={runAnalyze} disabled={loading || !buffer}>
            {loading ? (
              <ActivityIndicator color={colors.onGold} />
            ) : (
              <Text style={styles.btnText} selectable>
                Запустить анализ
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {step === 2 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle} selectable>
            3. Выбери кандидата
          </Text>
          <Text style={styles.body} selectable>
            Сильные (score≥55) выше. near_imm без строки — слабые, не жми True сразу.
          </Text>
          {cands.length === 0 ? (
            <Text style={styles.body} selectable>
              Пусто. Import dump / Blutter на ПК.
            </Text>
          ) : (
            cands.map((c, i) => (
              <TouchableOpacity
                key={c.offset + "-" + i}
                style={[styles.cand, picked?.offset === c.offset && styles.candOn]}
                onPress={() => {
                  setPicked(c);
                  setStep(3);
                }}
              >
                <Text style={styles.candOff} selectable>
                  {c.hexOffset} · {c.score}
                </Text>
                <Text style={styles.candMeta} selectable>
                  {c.movzHex}
                  {c.patchHex ? ` → ${c.patchHex}` : ""}
                </Text>
                <Text style={styles.candMeta} selectable numberOfLines={2}>
                  {c.reason}
                </Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      {step === 3 && picked && (
        <View style={styles.card}>
          <Text style={styles.cardTitle} selectable>
            4. Один патч
          </Text>
          <Text style={styles.body} selectable>
            {picked.hexOffset}
            {"\n"}
            {picked.movzHex} → {picked.patchHex || "?"}
            {"\n"}
            {picked.reason}
          </Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={applyPicked}
            disabled={!picked.patchHex}
          >
            <Text style={styles.btnText} selectable>
              Применить false→true
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnOutline}
            onPress={() => navigatePatch(navigation, picked.offset)}
          >
            <Text style={styles.btnOutlineText} selectable>
              Открыть Manual
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnGhost} onPress={() => setStep(2)}>
            <Text style={styles.btnGhostText} selectable>
              Другой кандидат
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {step === 4 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle} selectable>
            5. Готово
          </Text>
          <Text style={styles.body} selectable>
            Патч в памяти{dirty ? " (есть несохранённые изменения)" : ""}. Дальше: сохранить so /
            inject APK. Не ставь десятки патчей без проверки.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigateTab(navigation, "ApkTab")}>
            <Text style={styles.btnText} selectable>
              К APK
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnOutline} onPress={() => navigateTab(navigation, "PatchTab")}>
            <Text style={styles.btnOutlineText} selectable>
              К Патчу / очереди
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnGhost}
            onPress={() => {
              setStep(0);
              setPicked(null);
              setCands([]);
            }}
          >
            <Text style={styles.btnGhostText} selectable>
              Сначала
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <DeveloperFooter />
      <AppModal
        visible={!!modal}
        title={modal?.title || ""}
        message={modal?.message}
        onClose={() => setModal(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { color: colors.goldLight, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.textSecondary, marginTop: 6, marginBottom: 14, lineHeight: 19, fontSize: 13 },
  steps: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  stepPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepOn: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  stepDone: { borderColor: colors.borderGold },
  stepTxt: { color: colors.textSecondary, fontSize: 11, fontWeight: "700" },
  stepTxtOn: { color: colors.gold },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.borderGold,
    marginBottom: 12,
  },
  cardTitle: { color: colors.gold, fontWeight: "800", fontSize: 16, marginBottom: 8 },
  body: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 14 },
  btn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  btnText: { color: colors.onGold, fontWeight: "800", fontSize: 15 },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: colors.borderGold,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  btnOutlineText: { color: colors.gold, fontWeight: "700", fontSize: 14 },
  btnGhost: { padding: 12, alignItems: "center" },
  btnGhostText: { color: colors.textSecondary, fontWeight: "600" },
  cand: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  candOn: { borderColor: colors.gold },
  candOff: { color: colors.goldLight, fontFamily: "monospace", fontWeight: "800" },
  candMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
});
