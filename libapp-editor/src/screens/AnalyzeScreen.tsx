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
import { openLibappFile } from "../utils/openLibapp";
import CandidateCard from "../components/CandidateCard";
import { navigateRoot, navigatePatch } from "../utils/nav";
import { CodeCandidate } from "../utils/onDeviceRe";
import { runCodeSearch, stringsFromReport } from "../domain/codeSearch";
import { persistSession } from "../services/fileSession";
const APP_VER = APP_VERSION;

export default function AnalyzeScreen({ navigation }: any) {
  const { buffer, fileName, setFile, setBackupUri, setTextRange, setLastReport, dirty, enqueuePatch } = useAppFile();
  const [loading, setLoading] = useState(false);
  const [phase2, setPhase2] = useState(false);
  const [report, setReport] = useState<AnalyzeReport | null>(null);
  const [disasm, setDisasm] = useState<{ hexOffset: string; hex: string; asm: string; isCenter?: boolean }[]>([]);
  const [modal, setModal] = useState<{ title: string; message: string; actions?: any } | null>(null);
  const [codeCandidates, setCodeCandidates] = useState<CodeCandidate[]>([]);

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
    } finally {
      setLoading(false);
    }
  };

  const run = () => {
    if (!buffer) {
      setModal({ title: "Нет файла", message: "Нажми «Открыть libapp.so» выше или выбери файл на вкладке Файл." });
      return;
    }
    setLoading(true);
    setDisasm([]);
    setCodeCandidates([]);
    // Phase 1: ELF + risk (fast paint)
    requestAnimationFrame(() => {
      try {
        const r = analyzeLibapp(buffer, fileName || "libapp.so", APP_VER);
        logger.info("Analyze", "phase1", { risk: r.risk.level, score: r.risk.score });
        setReport(r);
        if (r.elf.textRange) setTextRange(r.elf.textRange);
        setLastReport(r);
        let fp: string | null = null;
        try {
          fp = soFingerprint(buffer);
        } catch {
          /* */
        }
        persistSession({
          fileName: fileName || "libapp.so",
          fingerprint: fp,
          dirty,
          textRange: r.elf.textRange
            ? { start: r.elf.textRange.start, end: r.elf.textRange.end }
            : null,
          lastRisk: r.risk.level,
        }).catch(() => {});
        setLoading(false);
        setPhase2(true);
        // Phase 2: candidates + meta (deferred)
        requestAnimationFrame(() => {
          try {
            const { candidates: cands } = runCodeSearch({
              buffer,
              textRange: r.elf.textRange,
              strings: stringsFromReport(r),
            });
            setCodeCandidates(cands);
            logger.info("Analyze", "phase2", { n: cands.length });
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
          if (r.getterNames[0]) {
            setDisasm(disasmAt(buffer, r.getterNames[0].offset, 10));
          }
          setPhase2(false);
        });
      } catch (e: any) {
        setModal({ title: "Ошибка анализа", message: e.message || String(e) });
        setLoading(false);
        setPhase2(false);
      }
    });
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
      ? colors.danger
      : report?.risk.level === "MEDIUM"
      ? colors.warning
      : colors.success;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Text style={styles.sub} selectable>
        {buffer ? (fileName || "файл в памяти") + (dirty ? " · изменён" : "") : "Файл не выбран"}
      </Text>
      <Text style={styles.hint} selectable>
        Полный отчёт: ELF, risk, Code candidates в .text. Строки isPro сами по себе не патчить — смотри кандидаты кода. Это не то же самое, что PRO-скан (там только маркеры платных фич).
      </Text>

      <TouchableOpacity style={styles.fileBtn} onPress={pickFile} disabled={loading}>
        <Text style={styles.fileBtnText} selectable>
          {buffer ? "Сменить libapp.so" : "Открыть libapp.so"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.mainBtn} onPress={run} disabled={loading || !buffer}>
        {loading ? <ActivityIndicator color={colors.onGold} /> : <Text style={styles.mainText} selectable>Сканировать</Text>}
      </TouchableOpacity>
      {phase2 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <ActivityIndicator color={colors.gold} size="small" />
          <Text style={{ color: colors.textSecondary, fontSize: 12 }} selectable>
            Phase 2: Code candidates…
          </Text>
        </View>
      ) : null}

      {report && (
        <>

          <View style={styles.ctaRow}>
            <TouchableOpacity
              style={[styles.ctaBtn, styles.ctaMain]}
              disabled={codeCandidates.length === 0}
              onPress={() => {
                const best = codeCandidates.find((c) => c.patchHex) || codeCandidates[0];
                if (!best) return;
                navigatePatch(navigation, best.offset);
              }}
            >
              <Text style={styles.ctaMainText} selectable>
                Лучший → Патч
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ctaBtn}
              onPress={() => navigateRoot(navigation, "Wizard")}
            >
              <Text style={styles.ctaText} selectable>Мастер</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ctaBtn}
              onPress={() => {
                let n = 0;
                for (const c of codeCandidates) {
                  if (!c.patchHex || c.score < 55) continue;
                  enqueuePatch({
                    offset: c.offset,
                    hexOffset: c.hexOffset,
                    oldHex: c.movzHex,
                    newHex: c.patchHex,
                    note: c.reason,
                    source: "analyze",
                  });
                  n++;
                  if (n >= 5) break;
                }
                setModal({
                  title: "Очередь",
                  message: n
                    ? `Добавлено сильных кандидатов: ${n}`
                    : "Нет сильных (score≥55) с patch HEX",
                  actions: n
                    ? [
                        {
                          label: "Открыть очередь",
                          onPress: () => {
                            setModal(null);
                            navigateRoot(navigation, "Queue");
                          },
                        },
                        { label: "OK", variant: "ghost" as const, onPress: () => setModal(null) },
                      ]
                    : [{ label: "OK", onPress: () => setModal(null) }],
                });
              }}
            >
              <Text style={styles.ctaText} selectable>В очередь</Text>
            </TouchableOpacity>
          </View>

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
                <CandidateCard
                  key={c.offset + "-" + i}
                  item={c}
                  onDisasm={() =>
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
                  onManual={() =>
                    navigatePatch(navigation, c.offset)
                  }
                  onEnqueue={
                    c.patchHex
                      ? () => {
                          enqueuePatch({
                            offset: c.offset,
                            hexOffset: c.hexOffset,
                            oldHex: c.movzHex,
                            newHex: c.patchHex!,
                            note: c.reason,
                            source: "analyze",
                          });
                          setModal({ title: "В очереди", message: c.hexOffset });
                        }
                      : undefined
                  }
                />
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
                      navigatePatch(navigation, s.offset);
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
            onPress={() => navigatePatch(navigation)}
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
        actions={(modal as any)?.actions}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { color: colors.goldLight, fontSize: 22, fontWeight: "800", letterSpacing: 0.2 },
  sub: { color: colors.textSecondary, marginTop: 4, marginBottom: 8, fontSize: 13 },
  hint: { color: colors.textSecondary, fontSize: 13, marginBottom: 16, lineHeight: 19 },
  fileBtn: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
    minHeight: 48,
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: colors.borderGold,
  },
  fileBtnText: { color: colors.gold, fontWeight: "800", fontSize: 15 },
  ctaRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  ctaBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.borderGold,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  ctaMain: { backgroundColor: colors.gold, borderColor: colors.gold, flex: 1.4 },
  ctaText: { color: colors.gold, fontWeight: "800", fontSize: 12 },
  ctaMainText: { color: colors.onGold, fontWeight: "800", fontSize: 13 },

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
