import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Switch, TextInput,
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";
import { useAppFile } from "../store/AppContext";
import { flutterAutoUnlock } from "../utils/flutterUnlock";
import { analyzeLibapp } from "../utils/analyze";
import { uint8ToBase64 } from "../utils/binary";
import { addHistoryRecord } from "../store/storage";
import AppModal from "../components/AppModal";
import DeveloperFooter from "../components/DeveloperFooter";
import { soFingerprint } from "../utils/hash";
import { logger } from "../utils/logger";
import { APP_VERSION } from "../version";

export default function AutoUnlockScreen() {
  const { buffer, fileName, updateBuffer } = useAppFile();
  /** Safe ON by default — Dron Alerts proved near_ret crashes apps */
  const [safe, setSafe] = useState(true);
  const [maxPatches, setMaxPatches] = useState("5");
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [patched, setPatched] = useState(0);
  const [localBuf, setLocalBuf] = useState<Uint8Array | null>(null);
  const [modal, setModal] = useState<{ title: string; message: string } | null>(null);
  const [riskHint, setRiskHint] = useState("");
  const [riskLevel, setRiskLevel] = useState<string>("");

  const precheck = () => {
    if (!buffer) return;
    try {
      const r = analyzeLibapp(buffer, fileName || "libapp.so", APP_VERSION);
      setRiskLevel(r.risk.level);
      setRiskHint(
        `Risk ${r.risk.level}: imm_ret=${r.patterns.immRet}, near12=${r.patterns.nearRet12}. ${r.risk.autoUnlockAdvice}`
      );
    } catch {
      setRiskHint("");
    }
  };

  React.useEffect(() => {
    precheck();
  }, [buffer]);

  const run = () => {
    if (!buffer) {
      setModal({ title: "Нет файла", message: "Открой libapp.so на вкладке «Поиск»." });
      return;
    }
    const max = Math.max(1, Math.min(50, parseInt(maxPatches, 10) || 5));
    const high = riskLevel === "HIGH" || riskLevel === "CRITICAL";
    if (high && !safe) {
      setModal({
        title: "Заблокировано",
        message:
          `Risk ${riskLevel}: aggressive Auto Unlock отключён.\n\n` +
          "Включи SAFE или иди в Analyze → Manual / Import dump.",
      });
      return;
    }
    if (high && safe) {
      setModal({
        title: "Высокий risk — подтверди",
        message:
          `Risk ${riskLevel}. Даже SAFE может сломать запуск.\n` +
          "Закрой это окно и нажми Auto Unlock ещё раз для подтверждения.\nИли лучше Manual / Import dump.",
      });
      (globalThis as any).__autoUnlockArmed = true;
      return;
    }
    if (!safe && !high) {
      if (!(globalThis as any).__autoAggressiveArmed) {
        setModal({
          title: "Aggressive — подтверди",
          message: "near_ret часто роняет приложение. Нажми Auto Unlock ещё раз для подтверждения.",
        });
        (globalThis as any).__autoAggressiveArmed = true;
        return;
      }
      (globalThis as any).__autoAggressiveArmed = false;
    }
    if ((globalThis as any).__autoUnlockArmed) {
      (globalThis as any).__autoUnlockArmed = false;
    }
    doUnlock(max);
  };

  const doUnlock = (max: number) => {
    setLoading(true);
    setTimeout(async () => {
      try {
        const result = flutterAutoUnlock(buffer!, { safe, maxPatches: max });
        setLocalBuf(result.buffer);
        updateBuffer(result.buffer);
        setPatched(result.stats.patched);
        setLog(
          result.notes.concat(
            result.hits.slice(0, 20).map(
              (h) => `${h.hexOffset} ${h.reg} ${h.kind} ${h.oldHex}→${h.newHex}`
            )
          )
        );

        const fp = soFingerprint(result.buffer);
        logger.info("AutoUnlock", "done", { patched: result.stats.patched, safe, max, fp });
        await addHistoryRecord({
          offset: 0,
          hexOffset: "auto",
          oldValue: "flutter-auto",
          newValue: `x${result.stats.patched}`,
          type: "hex",
          note: (safe ? `safe max=${max}` : `near max=${max}`) + ` fp=${fp}`,
          fingerprint: fp,
        });

        setModal({
          title: result.stats.patched ? "Auto Unlock" : "Ничего не найдено",
          message:
            result.stats.patched > 0
              ? `Патчей: ${result.stats.patched} (лимит ${max}, safe=${safe})\n` +
                `x0 FALSE: ${result.stats.x0FalseBefore} → ${result.stats.x0FalseAfter}\n` +
                `x0 TRUE: ${result.stats.x0TrueBefore} → ${result.stats.x0TrueAfter}\n\n` +
                `Обязательно проверь ЗАПУСК приложения. При вылете — верни backup.`
              : "Нет movz+#0+ret под текущие фильтры.\nСмотри Analyze Report.",
        });
      } catch (e: any) {
        setModal({ title: "Ошибка", message: e.message });
      } finally {
        setLoading(false);
      }
    }, 40);
  };

  const save = async () => {
    const buf = localBuf || buffer;
    if (!buf || patched === 0) {
      setModal({ title: "Нет изменений", message: "Сначала Auto Unlock" });
      return;
    }
    const b64 = uint8ToBase64(buf);
    const out =
      (FileSystem.cacheDirectory || "") +
      (fileName || "libapp").replace(/\.so$/i, "") +
      "_unlocked.so";
    await FileSystem.writeAsStringAsync(out, b64, { encoding: "base64" });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(out, { mimeType: "application/octet-stream" });
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={styles.title} selectable>Flutter Auto Unlock</Text>
      <Text style={styles.sub} selectable>
        {buffer ? fileName || "файл открыт" : "Сначала открой libapp.so"}
      </Text>

      <View style={styles.warnBox}>
        <Text style={styles.warnTitle} selectable>⚠ Experimental</Text>
        <Text style={styles.warnBody} selectable>
          Эвристика movz+ret не равна isPro. На Dron Alerts 3.3.0 даже 7 imm_ret дали вылет.
          По умолчанию: SAFE + лимит 5. Для PRO — Analyze + Manual / внешний RE.
        </Text>
        {!!riskHint && <Text style={styles.riskHint} selectable>{riskHint}</Text>}
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label} selectable>Только imm movz+ret (safe)</Text>
          <Text style={styles.hint} selectable>Выкл = near ret ≤12 байт (ОПАСНО)</Text>
        </View>
        <Switch
          value={safe}
          onValueChange={setSafe}
          trackColor={{ true: colors.gold, false: colors.border }}
        />
      </View>

      <Text style={styles.label} selectable>Макс. патчей (1–50)</Text>
      <TextInput
        style={styles.input}
        value={maxPatches}
        onChangeText={setMaxPatches}
        keyboardType="number-pad"
        placeholder="5"
        placeholderTextColor={colors.textSecondary}
      />

      <TouchableOpacity style={styles.mainBtn} onPress={run} disabled={loading || !buffer}>
        {loading ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.mainText} selectable>Сделать Auto Unlock</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.secBtn} onPress={save} disabled={patched === 0}>
        <Text style={styles.secText} selectable>Сохранить unlocked .so</Text>
      </TouchableOpacity>

      {log.length > 0 && (
        <View style={styles.log}>
          {log.map((line, i) => (
            <Text key={i} style={styles.logLine} selectable>{line}</Text>
          ))}
        </View>
      )}

      <DeveloperFooter />
      <AppModal
        visible={!!modal}
        title={modal?.title || ""}
        message={modal?.message || ""}
        onClose={() => setModal(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { color: colors.gold, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.textSecondary, marginTop: 4, marginBottom: 12 },
  warnBox: {
    backgroundColor: "#2A1A0A", borderRadius: 12, padding: 12, marginBottom: 16,
    borderWidth: 1, borderColor: "#E67E22",
  },
  warnTitle: { color: "#E67E22", fontWeight: "800", marginBottom: 4 },
  warnBody: { color: colors.text, fontSize: 13, lineHeight: 18 },
  riskHint: { color: colors.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 16 },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  label: { color: colors.text, fontWeight: "600" },
  hint: { color: colors.textSecondary, fontSize: 12 },
  input: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12, color: colors.text,
    borderWidth: 1, borderColor: colors.border, marginBottom: 14,
  },
  mainBtn: {
    backgroundColor: colors.gold, borderRadius: 14, padding: 16, alignItems: "center", marginBottom: 10,
  },
  mainText: { color: colors.onGold, fontWeight: "800", fontSize: 16 },
  secBtn: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, alignItems: "center",
    borderWidth: 1, borderColor: colors.border, marginBottom: 12,
  },
  secText: { color: colors.gold, fontWeight: "700" },
  log: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 10, marginTop: 8,
  },
  logLine: { color: colors.textSecondary, fontSize: 11, fontFamily: "monospace", marginBottom: 2 },
});
