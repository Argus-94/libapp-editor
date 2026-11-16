import React, { useMemo, useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView,
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";
import { useDialog } from "../components/DialogProvider";
import { logger } from "../utils/logger";
import { useAppFile } from "../store/AppContext";
import { findBoolsNear, applyBoolUnlock, deepUnlock } from "../utils/unlock";
import { uint8ToBase64 } from "../utils/binary";
import { addHistoryRecord } from "../store/storage";
import {
  scanPremiumFeatures,
  summarizeFeatures,
  highlightColor,
  CATEGORY_META,
  FeatureHit,
  FeatureCategory,
} from "../utils/premiumFeatures";
import DeveloperFooter from "../components/DeveloperFooter";
import { copyText } from "../utils/copyText";

const FILTERS: { id: "all" | FeatureCategory; title: string }[] = [
  { id: "all", title: "Все" },
  { id: "pro_getter", title: "GET" },
  { id: "pro_flag", title: "PRO" },
  { id: "subscription", title: "SUB" },
  { id: "iap", title: "IAP" },
  { id: "ads", title: "ADS" },
  { id: "paywall", title: "PAY" },
  { id: "trial", title: "TRL" },
];

export default function PremiumScanScreen({ navigation }: any) {
  const dialog = useDialog();
  const { buffer, fileName, updateBuffer, fingerprint } = useAppFile();
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<FeatureHit[]>([]);
  const [filter, setFilter] = useState<"all" | FeatureCategory>("all");
  const [patched, setPatched] = useState(0);
  const [localBuf, setLocalBuf] = useState<Uint8Array | null>(null);

  const activeBuf = localBuf || buffer;
  const summary = useMemo(() => summarizeFeatures(hits), [hits]);
  const visible = useMemo(
    () => (filter === "all" ? hits : hits.filter((h) => h.category === filter)),
    [hits, filter]
  );

  const scan = () => {
    if (!buffer) {
      dialog.alert("Нет файла", "Сначала открой libapp.so на вкладке «Поиск»");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      try {
        const src = localBuf || buffer;
        const found = scanPremiumFeatures(src);
        logger.info("Premium", "scan", { hits: found.length });
        setHits(found);
        setLoading(false);
        if (found.length === 0) {
          dialog.alert("Пусто", "Маркеры платных функций не найдены");
        }
      } catch (e: any) {
        setLoading(false);
        dialog.alert("Ошибка", e.message);
      }
    }, 40);
  };

  const unlockOne = async (item: FeatureHit, forceTrue: boolean) => {
    if (!activeBuf) return;
    if (item.score < 55) {
      dialog.confirm(
        "Слабый маркер",
        "Низкий приоритет — рядом скорее всего нет кода геттера.\nВсё равно патчить bool near?",
        () => doUnlock(item, forceTrue),
        "Патчить",
        true
      );
      return;
    }
    doUnlock(item, forceTrue);
  };

  const doUnlock = async (item: FeatureHit, forceTrue: boolean) => {
    if (!activeBuf) return;
    const bools = findBoolsNear(activeBuf, item.offset, 1536);
    let result = applyBoolUnlock(activeBuf, bools, forceTrue, 8);
    if (result.patched === 0) {
      result = deepUnlock(activeBuf, [item.offset], forceTrue);
    }
    if (result.patched === 0) {
      dialog.alert("Bool рядом нет", "Строка в data, код геттера далеко.\nОткрой Manual Patch или Analyze.");
      return;
    }
    setLocalBuf(result.buffer);
    updateBuffer(result.buffer);
    setPatched((c) => c + result.patched);
    await addHistoryRecord({
      offset: item.offset,
      hexOffset: item.hexOffset,
      oldValue: item.key,
      newValue: forceTrue ? "UNLOCK" : "LOCK",
      type: "hex",
      note: `premium:${item.category}`,
      fingerprint: fingerprint || undefined,
    });
    setHits(scanPremiumFeatures(result.buffer));
    dialog.alert(forceTrue ? "Патч" : "Откат", `${item.key}: ${result.patched} bool`);
  };

  const unlockCritical = (forceTrue: boolean) => {
    const targets = hits.filter((h) => h.highlight === "critical" || h.highlight === "high");
    if (!activeBuf || targets.length === 0) {
      dialog.alert("Нет high/critical", "Сначала скан");
      return;
    }
    dialog.alert(
      "Только high/critical",
      `Маркеров: ${targets.length}. Bool near могут быть случайными — риск краша.`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Патчить",
          style: "destructive",
          onPress: () => {
            setLoading(true);
            setTimeout(() => {
              try {
                const result = deepUnlock(
                  activeBuf,
                  targets.map((t) => t.offset),
                  forceTrue
                );
                setLocalBuf(result.buffer);
                updateBuffer(result.buffer);
                setPatched((c) => c + result.patched);
                setHits(scanPremiumFeatures(result.buffer));
                setLoading(false);
                dialog.alert("Готово", `Патчей: ${result.patched}`);
              } catch (e: any) {
                setLoading(false);
                dialog.alert("Ошибка", e.message);
              }
            }, 30);
          },
        },
      ]
    );
  };

  const saveFile = async () => {
    if (!activeBuf) return;
    const b64 = uint8ToBase64(activeBuf);
    const out =
      (FileSystem.cacheDirectory || "") +
      (fileName || "libapp").replace(/\.so$/i, "") +
      "_premium.so";
    await FileSystem.writeAsStringAsync(out, b64, { encoding: "base64" });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(out, { mimeType: "application/octet-stream" });
    }
  };

  const renderItem = ({ item }: { item: FeatureHit }) => {
    const cat = CATEGORY_META[item.category];
    const border = highlightColor(item);
    return (
      <View style={[styles.card, { borderLeftColor: border, borderLeftWidth: 4 }]}>
        <View style={styles.cardTop}>
          <View style={[styles.badge, { backgroundColor: cat.color }]}>
            <Text style={styles.badgeText} selectable>{cat.short}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.key} selectable>{item.label}</Text>
            <Text style={styles.meta} selectable>
              {item.hexOffset} · score {item.score} · {item.highlight}
            </Text>
          </View>
        </View>
        <Text style={styles.ctx} numberOfLines={1} selectable>
          {item.context}
        </Text>
        <Text style={styles.bools} selectable>
          near bool: false={item.boolsFalse} true={item.boolsTrue}
          {item.boolsFalse > 0
            ? "  · для разблока: TRUE (00..80D2 → 20..80D2)"
            : item.score >= 75
            ? "  · код геттера скорее НЕ рядом → Manual"
            : "  · weak / нет bool near"}
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.actBtn}
            onPress={() =>
              navigation?.navigate?.("ManualPatch", { initialOffset: item.offset })
            }
          >
            <Text style={styles.actText} selectable>Manual</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actBtn}
            onPress={() => copyText("offset", item.hexOffset)}
          >
            <Text style={styles.actText} selectable>Copy</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actBtn} onPress={() => unlockOne(item, true)}>
            <Text style={[styles.actText, { color: colors.success }]} selectable>→ TRUE (#1)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actBtn} onPress={() => unlockOne(item, false)}>
            <Text style={[styles.actText, { color: colors.danger }]} selectable>→ FALSE (#0)</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} selectable>Платные функции</Text>
        <Text style={styles.sub} selectable>
          {buffer ? fileName || "so в памяти" : "Открой libapp.so"}
          {patched > 0 ? ` · патчей ${patched}` : ""}
        </Text>

        <TouchableOpacity style={styles.scanBtn} onPress={scan} disabled={loading || !buffer}>
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.scanText} selectable>Сканировать и подсветить</Text>
          )}
        </TouchableOpacity>

        <View style={styles.cheat}>
          <Text style={styles.cheatTitle} selectable>Что ставить для разблокировки</Text>
          <Text style={styles.cheatBody} selectable>
            {`Не строку isPro, а машинный код рядом (если он есть):
  FALSE → TRUE (разблок):
  00 00 80 D2  →  20 00 80 D2   (movz x0, #0 → #1)
  00 00 80 52  →  20 00 80 52   (movz w0, #0 → #1)

Кнопка → TRUE (#1) = найти FALSE near и заменить на TRUE.
Кнопка → FALSE (#0) = откат.

Если near bool: false=0 — кода рядом нет, жми Manual / Import dump.`}
          </Text>
        </View>


        {hits.length > 0 && (
          <>
            <View style={styles.summaryBox}>
              <Text style={styles.summaryTitle} selectable>
                Найдено {hits.length} · critical {summary.critical} · high {summary.high}
              </Text>
              <Text style={styles.summaryKeys} selectable>
                Топ: {summary.topKeys.slice(0, 6).join(", ") || "—"}
              </Text>
              <View style={styles.catRow}>
                {Object.entries(summary.byCategory).map(([k, n]) => (
                  <View
                    key={k}
                    style={[styles.catChip, { borderColor: CATEGORY_META[k as FeatureCategory]?.color }]}
                  >
                    <Text style={styles.catChipText} selectable>
                      {CATEGORY_META[k as FeatureCategory]?.short || k} {n}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
              {FILTERS.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={[styles.filterChip, filter === f.id && styles.filterActive]}
                  onPress={() => setFilter(f.id)}
                >
                  <Text style={[styles.filterText, filter === f.id && styles.filterTextActive]} selectable>
                    {f.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.bulkRow}>
              <TouchableOpacity style={styles.bulkBtn} onPress={() => unlockCritical(true)}>
                <Text style={styles.bulkText} selectable>TRUE high/critical</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.bulkBtn} onPress={saveFile}>
                <Text style={styles.bulkText} selectable>Share .so</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      <FlatList
        data={visible}
        keyExtractor={(item) => item.offset + ":" + item.key}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty} selectable>
              Нажми «Сканировать» — красные/оранжевые = сильные PRO-маркеры.
              {"\n"}Строка ≠ код геттера: для ownsPro нужен Manual / R2.
            </Text>
          ) : null
        }
        ListFooterComponent={<DeveloperFooter />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  title: { color: colors.gold, fontSize: 20, fontWeight: "800" },
  sub: { color: colors.textSecondary, marginTop: 2, marginBottom: 10, fontSize: 13 },
  scanBtn: {
    backgroundColor: colors.gold, borderRadius: 12, padding: 14, alignItems: "center",
  },
  scanText: { color: colors.onGold, fontWeight: "800" },
  summaryBox: {
    marginTop: 12, backgroundColor: colors.surface, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  summaryTitle: { color: colors.text, fontWeight: "700", fontSize: 13 },
  summaryKeys: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  catChip: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  catChipText: { color: colors.text, fontSize: 11, fontWeight: "600" },
  filters: { marginTop: 10, maxHeight: 40 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, marginRight: 8,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  filterActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  filterText: { color: colors.textSecondary, fontWeight: "700", fontSize: 12 },
  filterTextActive: { color: colors.onGold },
  bulkRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  bulkBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: colors.border, alignItems: "center",
  },
  bulkText: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  card: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeText: { color: colors.onGold, fontWeight: "900", fontSize: 11 },
  key: { color: colors.text, fontWeight: "700", fontSize: 14 },
  meta: { color: colors.textSecondary, fontSize: 11, fontFamily: "monospace" },
  ctx: { color: colors.textSecondary, fontSize: 11, fontFamily: "monospace", marginTop: 6 },
  bools: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10 },
  actBtn: {
    flex: 1, backgroundColor: colors.surfaceLight, borderRadius: 8, padding: 8, alignItems: "center",
  },
  actText: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  empty: { color: colors.textSecondary, textAlign: "center", marginTop: 40, lineHeight: 20, paddingHorizontal: 20 },
  cheat: {
    marginTop: 12, backgroundColor: colors.surface, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: colors.gold,
  },
  cheatTitle: { color: colors.gold, fontWeight: "800", fontSize: 13, marginBottom: 6 },
  cheatBody: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, fontFamily: "monospace" },
});
