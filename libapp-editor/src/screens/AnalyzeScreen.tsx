import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView, Share,
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";
import { useAppFile } from "../store/AppContext";
import { analyzeLibapp, AnalyzeReport, disasmAt } from "../utils/analyze";
import { reportToJson, reportToMarkdown } from "../utils/report";
import AppModal from "../components/AppModal";
import DeveloperFooter from "../components/DeveloperFooter";
import { saveLastAnalyze } from "../store/storage";
import { soFingerprint } from "../utils/hash";
import { summarizeFeatures, scanPremiumFeatures } from "../utils/premiumFeatures";

import { APP_VERSION } from "../version";
import { copyText } from "../utils/copyText";
import SelectableText from "../components/SelectableText";
import { logger } from "../utils/logger";
import { scanCodeCandidates, CodeCandidate } from "../utils/onDeviceRe";
const APP_VER = APP_VERSION;

export default function AnalyzeScreen({ navigation }: any) {
  const { buffer, fileName } = useAppFile();
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<AnalyzeReport | null>(null);
  const [disasm, setDisasm] = useState<{ hexOffset: string; hex: string; asm: string; isCenter?: boolean }[]>([]);
  const [modal, setModal] = useState<{ title: string; message: string } | null>(null);
  const [codeCandidates, setCodeCandidates] = useState<CodeCandidate[]>([]);

  const run = () => {
    if (!buffer) {
      setModal({ title: "Нет файла", message: "Открой libapp.so на вкладке «Поиск»." });
      return;
    }
    setLoading(true);
    setDisasm([]);
    setCodeCandidates([]);
    setTimeout(() => {
      try {
        const r = analyzeLibapp(buffer, fileName || "libapp.so", APP_VER);
        logger.info("Analyze", "done", { risk: r.risk.level, score: r.risk.score, imm: r.patterns.immRet });
        setReport(r);
        try {
          const cands = scanCodeCandidates({
            buffer,
            textRange: r.elf.textRange,
            strings: r.getterNames.map((g) => ({ key: g.key, offset: g.offset })),
          });
          setCodeCandidates(cands);
          logger.info("Analyze", "codeCandidates", { n: cands.length, top: cands[0]?.hexOffset });
        } catch (e: any) {
          setCodeCandidates([]);
          logger.warn("Analyze", "codeCandidates failed", e?.message);
        }
        try {
          const feats = scanPremiumFeatures(buffer, { maxPerKey: 4, boolRadius: 0 });
          const sum = summarizeFeatures(feats);
          saveLastAnalyze({
            fileName: fileName || "libapp.so",
            fileSize: buffer.length,
            riskLevel: r.risk.level,
            riskScore: r.risk.score,
            immRet: r.patterns.immRet,
            nearRet12: r.patterns.nearRet12,
            topKeys: sum.topKeys,
            fingerprint: soFingerprint(buffer),
            analyzedAt: Date.now(),
          });
        } catch {}
        // auto-disasm first getter if any
        if (r.getterNames[0]) {
          setDisasm(disasmAt(buffer, r.getterNames[0].offset, 10));
        }
      } catch (e: any) {
        setModal({ title: "Ошибка анализа", message: e.message || String(e) });
      } finally {
        setLoading(false);
      }
    }, 40);
  };

  const exportReport = async (fmt: "md" | "json") => {
    if (!report) return;
    const body = fmt === "md" ? reportToMarkdown(report) : reportToJson(report);
    const name =
      (fileName || "libapp").replace(/\.so$/i, "") +
      `_analyze.${fmt === "md" ? "md" : "json"}`;
    const path = (FileSystem.cacheDirectory || "") + name;
    await FileSystem.writeAsStringAsync(path, body, { encoding: "utf8" });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(path, {
        mimeType: fmt === "md" ? "text/markdown" : "application/json",
      });
    } else {
      await Share.share({ message: body.slice(0, 8000), title: name });
    }
  };

  const riskColor =
    report?.risk.level === "CRITICAL" || report?.risk.level === "HIGH"
      ? "#E74C3C"
      : report?.risk.level === "MEDIUM"
      ? "#F39C12"
      : "#2ECC71";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={styles.title} selectable>2. Анализ</Text>
      <Text style={styles.sub} selectable>
        {buffer ? fileName || "файл в памяти" : "Сначала открой libapp.so"}
      </Text>
      <Text style={styles.hint} selectable>
        Шаг 2: risk + Code candidates в .text. Строки isPro — не патчить. Дальше вкладка «Патч».
      </Text>

      <TouchableOpacity style={styles.mainBtn} onPress={run} disabled={loading || !buffer}>
        {loading ? <ActivityIndicator color={colors.onGold} /> : <Text style={styles.mainText} selectable>Сканировать</Text>}
      </TouchableOpacity>

      {report && (
        <>
          <View style={[styles.card, { borderColor: riskColor }]}>
            <Text style={[styles.risk, { color: riskColor }]} selectable>
              RISK {report.risk.level} · {report.risk.score}
            </Text>
            <Text style={styles.advice} selectable>{report.risk.autoUnlockAdvice}</Text>
            {report.risk.reasons.map((x, i) => (
              <Text key={i} style={styles.reason} selectable>• {x}</Text>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.section} selectable>ELF / Snapshot</Text>
            <Text style={styles.mono} selectable>
              {report.elf.isElf ? `${report.elf.machine} ${report.elf.class}-bit ${report.elf.type}` : "not ELF"}
              {"\n"}size {(report.fileSize / 1024 / 1024).toFixed(2)} MB
              {report.elf.snapshotHash ? `\nhash ${report.elf.snapshotHash}` : ""}
              {report.elf.textRange
                ? `\n.text 0x${report.elf.textRange.start.toString(16)}–0x${report.elf.textRange.end.toString(16)}`
                : ""}
            </Text>
            {report.elf.loadSegments.map((s, i) => (
              <Text key={i} style={styles.monoSmall} selectable>
                LOAD {s.flags} off=0x{s.offset.toString(16)} sz=0x{s.filesz.toString(16)}
              </Text>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.section} selectable>Bool patterns</Text>
            <Text style={styles.mono} selectable>
              movz x0 #0 / #1 : {report.patterns.movzX0False} / {report.patterns.movzX0True}
              {"\n"}movz w0 #0 / #1 : {report.patterns.movzW0False} / {report.patterns.movzW0True}
              {"\n"}imm_ret (safe) : {report.patterns.immRet}
              {"\n"}near_ret ≤12 / ≤32 : {report.patterns.nearRet12} / {report.patterns.nearRet32}
              {"\n"}ret total : {report.patterns.retCount}
            </Text>
          </View>

          <View style={[styles.card, styles.cardGold]}>
            <Text style={styles.section} selectable>
              Code candidates · {codeCandidates.length}
            </Text>
            <Text style={styles.note} selectable>
              Эвристика on-device (не Blutter). Патчить offset из списка ниже —
              обычно внутри .text
              {report.elf.textRange
                ? ` (0x${report.elf.textRange.start.toString(16)}–0x${report.elf.textRange.end.toString(16)})`
                : ""}
              , не строки isPro.
            </Text>
            {codeCandidates.length === 0 ? (
              <Text style={styles.muted} selectable>
                Кандидатов нет. Import dump или Blutter на ПК.
              </Text>
            ) : (
              codeCandidates.slice(0, 25).map((c, i) => (
                <View key={i} style={styles.cand}>
                  <Text style={styles.candOff} selectable>
                    {c.hexOffset}
                  </Text>
                  <Text style={styles.candMeta} selectable>
                    score {c.score} · {c.kind}
                    {c.stringKey ? ` · ${c.stringKey}` : ""}
                  </Text>
                  <Text style={styles.candHex} selectable>
                    {c.movzHex}
                    {c.patchHex ? `  →  ${c.patchHex}` : ""}
                  </Text>
                  <Text style={styles.candReason} selectable numberOfLines={3}>
                    {c.reason}
                  </Text>
                  <View style={styles.candActions}>
                    <TouchableOpacity
                      style={styles.candBtn}
                      onPress={() =>
                        setDisasm(
                          c.disasm.map((l) => ({
                            hexOffset:
                              "0x" + l.offset.toString(16).toUpperCase().padStart(8, "0"),
                            hex: l.hex,
                            asm: l.asm,
                            isCenter: l.isCenter,
                          }))
                        )
                      }
                    >
                      <Text style={styles.candBtnText} selectable>Disasm</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.candBtn, styles.candBtnMain]}
                      onPress={() =>
                        navigation.navigate("ManualPatch", { initialOffset: c.offset })
                      }
                    >
                      <Text style={styles.candBtnTextMain} selectable>Manual</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.candBtn}
                      onPress={() => copyText("offset", c.hexOffset)}
                    >
                      <Text style={styles.candBtnText} selectable>Copy</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.section} selectable>PRO / getters ({report.getterNames.length})</Text>
            {report.getterNames.length === 0 ? (
              <Text style={styles.dim} selectable>Не найдено типовых имён геттеров</Text>
            ) : (
              report.getterNames.slice(0, 30).map((s, i) => (
                <View key={i} style={{ marginBottom: 8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      if (buffer) setDisasm(disasmAt(buffer, s.offset, 12));
                    }}
                    onLongPress={() => {
                      navigation.navigate("ManualPatch", { initialOffset: s.offset });
                    }}
                  >
                    <Text style={styles.hit} selectable>
                      {s.hexOffset}  {s.key}
                    </Text>
                    <Text style={styles.hitHint} selectable>tap=disasm · long=Manual</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => copyText("offset", s.hexOffset)}>
                    <Text style={{ color: colors.gold, fontSize: 11, fontWeight: "700", marginTop: 2 }} selectable>
                      Copy offset
                    </Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.section} selectable>Strings by category</Text>
            {(["pro", "iap", "ads"] as const).map((cat) => {
              const list = report.strings.filter((s) => s.category === cat);
              if (!list.length) return null;
              return (
                <View key={cat} style={{ marginBottom: 10 }}>
                  <Text style={styles.cat} selectable>{cat.toUpperCase()} ({list.length})</Text>
                  {list.slice(0, 15).map((s, i) => (
                    <Text key={i} style={styles.hit} selectable>
                      {s.hexOffset}  {s.key}
                    </Text>
                  ))}
                </View>
              );
            })}
          </View>

          {disasm.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.section} selectable>Disasm window</Text>
              {disasm.map((l, i) => (
                <Text
                  key={i}
                  style={[styles.monoSmall, l.isCenter && { color: colors.gold }]}
                 selectable>
                  {l.hexOffset}  {l.hex}  {l.asm}
                </Text>
              ))}
            </View>
          )}

          <View style={styles.row}>
            <TouchableOpacity style={styles.secBtn} onPress={() => exportReport("md")}>
              <Text style={styles.secText} selectable>Export MD</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secBtn} onPress={() => exportReport("json")}>
              <Text style={styles.secText} selectable>Export JSON</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.secBtn, { marginTop: 10 }]}
            onPress={() => navigation.navigate("ManualPatch")}
          >
            <Text style={styles.secText} selectable>→ Manual Patch по offset</Text>
          </TouchableOpacity>
        </>
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
  title: { color: colors.goldLight, fontSize: 22, fontWeight: "800", letterSpacing: 0.2 },
  sub: { color: colors.textSecondary, marginTop: 4, marginBottom: 8, fontSize: 13 },
  hint: { color: colors.textSecondary, fontSize: 13, marginBottom: 16, lineHeight: 19 },
  mainBtn: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 16,
    minHeight: 52,
    justifyContent: "center",
  },
  mainText: { color: colors.onGold, fontWeight: "800", fontSize: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardGold: { borderColor: colors.borderGold },
  risk: { fontWeight: "800", fontSize: 16, marginBottom: 6 },
  advice: { color: colors.text, marginBottom: 8, lineHeight: 20, fontSize: 14 },
  reason: { color: colors.textSecondary, fontSize: 13, marginTop: 3, lineHeight: 18 },
  section: { color: colors.gold, fontWeight: "800", fontSize: 15, marginBottom: 10 },
  note: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 12 },
  muted: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  mono: { color: colors.text, fontFamily: "monospace", fontSize: 12, lineHeight: 18 },
  monoSmall: { color: colors.textSecondary, fontFamily: "monospace", fontSize: 11, lineHeight: 16 },
  hit: { color: colors.goldLight, fontFamily: "monospace", fontSize: 13, marginTop: 6, fontWeight: "700" },
  hitHint: { color: colors.textSecondary, fontSize: 11, marginBottom: 2, lineHeight: 16 },
  cat: { color: colors.gold, fontWeight: "700", marginBottom: 6, fontSize: 13 },
  dim: { color: colors.textSecondary },
  row: { flexDirection: "row", gap: 10 },
  secBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.borderGold,
    alignItems: "center",
    justifyContent: "center",
  },
  secText: { color: colors.gold, fontWeight: "700", fontSize: 14 },
  cand: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  candOff: {
    color: colors.goldLight,
    fontFamily: "monospace",
    fontWeight: "800",
    fontSize: 14,
  },
  candMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  candHex: {
    color: colors.text,
    fontFamily: "monospace",
    fontSize: 12,
    marginTop: 6,
  },
  candReason: { color: colors.textSecondary, fontSize: 11, marginTop: 6, lineHeight: 16 },
  candActions: { flexDirection: "row", gap: 8, marginTop: 12 },
  candBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderGold,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  candBtnMain: { backgroundColor: colors.gold, borderColor: colors.gold },
  candBtnText: { color: colors.gold, fontWeight: "800", fontSize: 13 },
  candBtnTextMain: { color: colors.onGold, fontWeight: "800", fontSize: 13 },
});
