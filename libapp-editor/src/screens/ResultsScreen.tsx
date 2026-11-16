import React, { useState, useEffect } from "react";
import {
  View, Text, FlatList, StyleSheet, TextInput, Modal,
  TouchableOpacity, ActivityIndicator, ScrollView,
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";
import { logger } from "../utils/logger";
import ResultItem from "../components/ResultItem";
import AppModal from "../components/AppModal";
import {
  replaceAt, hexToBytes, toggleArm64Bool, uint8ToBase64, disasmAround,
} from "../utils/binary";
import {
  isPremiumKey, findBoolsNear, applyBoolUnlock, deepUnlock, BoolHit,
} from "../utils/unlock";
import { SearchResult, PatchRecord } from "../types";
import { addHistoryRecord, loadBookmarks, saveBookmarks } from "../store/storage";
import { useAppFile } from "../store/AppContext";
import { copyText } from "../utils/copyText";
import { CodeCandidate } from "../utils/onDeviceRe";
import { runCodeSearch } from "../domain/codeSearch";
import CandidateCard from "../components/CandidateCard";
import { navigateRoot, navigatePatch, navigateTab } from "../utils/nav";

export default function ResultsScreen({ route, navigation }: any) {
  const { updateBuffer, enqueuePatch, markClean, buffer: ctxBuffer, fileName: ctxFileName, fingerprint } = useAppFile();
  const { results: initialResults, buffer: initialBuffer, fileName: paramFileName, fromApk } = route.params || {};
  const fileName = paramFileName || ctxFileName || "libapp.so";

  const [results] = useState<SearchResult[]>(() => {
    const list = [...(initialResults || [])];
    // premium-ish strings first
    const score = (s: SearchResult) => {
      if (s.type !== "string") return 0;
      const v = (s.matchedValue || "").toLowerCase();
      let sc = 0;
      if (v.includes("ownspro") || v.includes("ispro")) sc += 50;
      if (v.includes("premium") || v.includes("subscri")) sc += 30;
      if (v.includes("purchase") || v.includes("iap")) sc += 20;
      if (isPremiumKey(s.matchedValue)) sc += 25;
      return sc;
    };
    list.sort((a, b) => score(b) - score(a) || a.offset - b.offset);
    return list;
  });
  // Prefer context buffer (single source of truth); params buffer only as legacy fallback
  const [buffer, setBuffer] = useState<Uint8Array | null>(() => {
    if (initialBuffer instanceof Uint8Array) return initialBuffer;
    if (ctxBuffer instanceof Uint8Array) return ctxBuffer;
    return null;
  });

  // If opened without params buffer, pick up AppContext when available
  useEffect(() => {
    if (!buffer && ctxBuffer instanceof Uint8Array) setBuffer(ctxBuffer);
  }, [ctxBuffer, buffer]);
  const [modalVisible, setModalVisible] = useState(false);
  const [currentItem, setCurrentItem] = useState<SearchResult | null>(null);
  const [customValue, setCustomValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [patchedCount, setPatchedCount] = useState(0);
  const [disasmVisible, setDisasmVisible] = useState(false);
  const [disasmLines, setDisasmLines] = useState<{ offset: number; hex: string; asm: string }[]>([]);
  const [disasmTitle, setDisasmTitle] = useState("");
  const [actionVisible, setActionVisible] = useState(false);
  const [actionItem, setActionItem] = useState<SearchResult | null>(null);
  const [nearbyBools, setNearbyBools] = useState<BoolHit[]>([]);
  const [codeCands, setCodeCands] = useState<CodeCandidate[]>([]);
  const [codeCandsVisible, setCodeCandsVisible] = useState(false);
  const [codeCandsLoading, setCodeCandsLoading] = useState(false);
  const [infoModal, setInfoModal] = useState<{
    title: string;
    message: string;
    actions?: { label: string; onPress: () => void; variant?: "primary" | "outline" | "ghost" }[];
  } | null>(null);

  const addToHistory = async (rec: Omit<PatchRecord, "id" | "timestamp">) => {
    await addHistoryRecord({
      ...rec,
      fingerprint: rec.fingerprint || fingerprint || undefined,
    });
  };

  // buffer updates go through AppContext (no function-in-params)

  const commitBuffer = async (updated: Uint8Array, extra: number, note: string) => {
    setBuffer(updated);
    setPatchedCount((c) => c + extra);
    try { updateBuffer(updated); } catch { /* ignore */ }
    await addToHistory({
      offset: 0,
      hexOffset: "batch",
      oldValue: note,
      newValue: `x${extra}`,
      type: "hex",
      note,
      fingerprint: fingerprint || undefined,
    });
  };

  const applyPatch = async (
    offset: number,
    newBytes: Uint8Array,
    oldHex: string,
    newHex: string,
    type: "string" | "hex"
  ) => {
    if (!buffer) {
      setInfoModal({
        title: "Нет буфера",
        message: "Файл не загружен. Вернись на Поиск и открой libapp.so.",
        actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
      });
      return;
    }
    try {
      logger.info("Results", "patch", { offset, newHex });
      const updated = replaceAt(buffer, offset, newBytes);
      setBuffer(updated);
      setPatchedCount((c) => c + 1);
      try { updateBuffer(updated); } catch { /* ignore */ }
      await addToHistory({
        offset,
        hexOffset: "0x" + offset.toString(16).toUpperCase().padStart(8, "0"),
        oldValue: oldHex,
        newValue: newHex,
        type,
      });
      setInfoModal({
        title: "Патч применён",
        message: `Было: ${oldHex}\nСтало: ${newHex}\n\nНажми «Сохранить», чтобы выгрузить файл.`,
        actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
      });
    } catch (e: any) {
      setInfoModal({
        title: "Ошибка",
        message: e.message,
        actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
      });
    }
  };

  const handleSmartAction = (item: SearchResult) => {
    if (item.type === "hex") {
      const nextHex = toggleArm64Bool(item.matchedValue);
      if (nextHex) {
        applyPatch(item.offset, hexToBytes(nextHex), item.matchedValue, nextHex, "hex");
      } else {
        openCustom(item);
      }
      return;
    }

    const lower = item.matchedValue.toLowerCase();
    if (["true", "false", "0", "1", "yes", "no"].includes(lower)) {
      const map: Record<string, string> = {
        true: "false", false: "true", "1": "0", "0": "1", yes: "no", no: "yes",
      };
      const next = map[lower];
      const enc = new TextEncoder();
      const oldB = enc.encode(item.matchedValue);
      const padded = next.padEnd(oldB.length, "\0").slice(0, oldB.length);
      applyPatch(item.offset, enc.encode(padded), item.matchedValue, next, "string");
      return;
    }

    if (!buffer) return;
    const hits = findBoolsNear(buffer, item.offset, 2048);
    setActionItem(item);
    setNearbyBools(hits);
    if (hits.length === 0 && item.type === "string") {
      // Любая строка в data без bool рядом → ищем код/регистры в .text
      setCodeCandsLoading(true);
      setInfoModal({
        title: "Ищем код / регистры…",
        message: `«${item.matchedValue}» — bool рядом нет. Ищем xref и movz x0/w0 в .text.`,
        actions: [{ label: "Ждите", onPress: () => {} }],
      });
      setTimeout(() => {
        try {
          const cands = runCodeSearch({
            buffer,
            strings: [{ key: item.matchedValue, offset: item.offset }],
          }).candidates;
          const linked = cands.filter(
            (c) =>
              c.stringKey &&
              (c.stringKey === item.matchedValue ||
                item.matchedValue.includes(c.stringKey) ||
                c.stringKey.includes(item.matchedValue.replace(/^get:/, "")))
          );
          const list = (linked.length ? linked : cands).slice(0, 20);
          setCodeCands(list);
          setInfoModal(null);
          setCodeCandsLoading(false);
          if (list.length === 0) {
            setInfoModal({
              title: "Код не найден",
              message:
                "Автоматически не нашли. Открой Analyze → Code candidates или Import dump.",
              actions: [
                {
                  label: "Analyze",
                  onPress: () => {
                    setInfoModal(null);
                    navigateTab(navigation, "AnalyzeTab");
                  },
                },
                { label: "OK", onPress: () => setInfoModal(null), variant: "ghost" },
              ],
            });
          } else {
            setCodeCandsVisible(true);
          }
        } catch (e: any) {
          setCodeCandsLoading(false);
          setInfoModal({
            title: "Ошибка",
            message: e?.message || String(e),
            actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
          });
        }
      }, 40);
      return;
    }
    setActionVisible(true);
  };

  const doUnlock = async (forceTrue: boolean, deep: boolean) => {
    if (!actionItem || !buffer) return;
    setActionVisible(false);

    let result;
    if (deep) {
      result = deepUnlock(buffer, [actionItem.offset], forceTrue);
    } else {
      result = applyBoolUnlock(buffer, nearbyBools, forceTrue, 20);
      if (result.patched === 0) {
        result = deepUnlock(buffer, [actionItem.offset], forceTrue);
      }
    }

    if (result.patched === 0) {
      // Нет bool рядом → ищем код/регистры в .text по этой PRO-строке
      setCodeCandsLoading(true);
      setInfoModal({
        title: "Ищем код в .text…",
        message:
          `«${actionItem.matchedValue}» в data — bool рядом нет.\n` +
          `Ищем ADRP/регистры (x0/w0 movz) по выбранной строке — не только isPro.`,
        actions: [{ label: "Ждите", onPress: () => {} }],
      });
      setTimeout(() => {
        try {
          const cands = runCodeSearch({
            buffer,
            strings: [{ key: actionItem.matchedValue, offset: actionItem.offset }],
          }).candidates;
          // Prefer linked to this key
          const linked = cands.filter(
            (c) =>
              c.stringKey &&
              (c.stringKey === actionItem.matchedValue ||
                actionItem.matchedValue.includes(c.stringKey) ||
                c.stringKey.includes(actionItem.matchedValue.replace(/^get:/, "")))
          );
          const list = (linked.length ? linked : cands).slice(0, 20);
          setCodeCands(list);
          setCodeCandsLoading(false);
          setInfoModal(null);
          if (list.length === 0) {
            setInfoModal({
              title: "Код не найден автоматически",
              message:
                `По «${actionItem.matchedValue}» xref/movz в .text не нашли.\n` +
                `Попробуй Analyze → Code candidates или Import dump (Blutter).`,
              actions: [
                {
                  label: "Открыть Analyze",
                  onPress: () => {
                    setInfoModal(null);
                    navigateTab(navigation, "AnalyzeTab");
                  },
                },
                { label: "OK", onPress: () => setInfoModal(null), variant: "ghost" },
              ],
            });
          } else {
            setCodeCandsVisible(true);
          }
        } catch (e: any) {
          setCodeCandsLoading(false);
          setInfoModal({
            title: "Ошибка поиска кода",
            message: e?.message || String(e),
            actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
          });
        }
      }, 40);
      return;
    }

    await commitBuffer(
      result.buffer,
      result.patched,
      forceTrue ? "unlock→true" : "lock→false"
    );

    setInfoModal({
      title: forceTrue ? "Разблокировано" : "Заблокировано",
      message:
        `Изменено проверок: ${result.patched}\n\n` +
        result.details.slice(0, 5).join("\n") +
        (result.details.length > 5 ? "\n…" : "") +
        `\n\nОбязательно нажми «Сохранить».`,
      actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
    });
  };

  const openCustom = (item: SearchResult) => {
    setCurrentItem(item);
    setCustomValue(item.matchedValue);
    setModalVisible(true);
  };

  const applyCustom = () => {
    if (!currentItem) return;
    try {
      // For premium keys warn if user tries to replace name with true
      if (
        currentItem.type === "string" &&
        isPremiumKey(currentItem.matchedValue) &&
        ["true", "false", "1", "0", "yes", "no"].includes(customValue.toLowerCase())
      ) {
        setModalVisible(false);
        setInfoModal({
          title: "Так unlock не работает",
          message:
            `«${currentItem.matchedValue}» — имя функции/поля.\n` +
            `Замена на «${customValue}» почти никогда не открывает Pro.\n\n` +
            `Нужно патчить bool-инструкции рядом (кнопка «Разблок»).`,
          actions: [
            {
              label: "Разблок",
              onPress: () => {
                setInfoModal(null);
                handleSmartAction(currentItem);
              },
            },
            {
              label: "Всё равно заменить",
              variant: "outline" as const,
              onPress: () => {
                setInfoModal(null);
                doStringReplace(currentItem, customValue);
              },
            },
            {
              label: "Отмена",
              variant: "ghost" as const,
              onPress: () => setInfoModal(null),
            },
          ],
        });
        return;
      }
      doStringReplace(currentItem, customValue);
      setModalVisible(false);
    } catch (e: any) {
      setInfoModal({
        title: "Ошибка",
        message: e.message,
        actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
      });
    }
  };

  const doStringReplace = (item: SearchResult, value: string) => {
    if (item.type === "string") {
      const enc = new TextEncoder();
      const oldLen = enc.encode(item.matchedValue).length;
      const padded = value.padEnd(oldLen, "\0").slice(0, oldLen);
      applyPatch(item.offset, enc.encode(padded), item.matchedValue, value, "string");
    } else {
      const newBytes = hexToBytes(value);
      const oldLen = hexToBytes(item.matchedValue).length;
      if (newBytes.length !== oldLen) {
        setInfoModal({
          title: "Разная длина",
          message: `Нужно ${oldLen} байт, сейчас ${newBytes.length}`,
          actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
        });
        return;
      }
      applyPatch(item.offset, newBytes, item.matchedValue, value, "hex");
    }
  };

  const suggestionsFor = (item: SearchResult | null): { label: string; value: string; hint: string }[] => {
    if (!item) return [];
    if (item.type === "hex") {
      return [
        { label: "TRUE x0", value: "20 00 80 D2", hint: "movz x0,#1 (Flutter)" },
        { label: "FALSE x0", value: "00 00 80 D2", hint: "movz x0,#0" },
        { label: "TRUE w0", value: "20 00 80 52", hint: "movz w0,#1" },
        { label: "FALSE w0", value: "00 00 80 52", hint: "movz w0,#0" },
      ];
    }
    if (isPremiumKey(item.matchedValue)) {
      return []; // don't suggest wrong string replaces
    }
    const lower = item.matchedValue.toLowerCase();
    if (lower === "true" || lower === "false") {
      return [
        { label: "true", value: "true", hint: "включено" },
        { label: "false", value: "false", hint: "выключено" },
      ];
    }
    return [
      { label: "true", value: "true", hint: "" },
      { label: "false", value: "false", hint: "" },
      { label: "1", value: "1", hint: "" },
      { label: "0", value: "0", hint: "" },
    ];
  };

  const addBookmark = async (item: SearchResult) => {
    const list = await loadBookmarks();
    list.unshift({
      id: Date.now().toString(36),
      offset: item.offset,
      hexOffset: item.hexOffset,
      label: item.matchedValue,
      value: item.matchedValue,
      fileName,
      createdAt: Date.now(),
    });
    await saveBookmarks(list);
    setInfoModal({
      title: "Закладка",
      message: "Добавлено в закладки",
      actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
    });
  };

  const showDisasm = (item: SearchResult) => {
    if (!buffer) return;
    setDisasmLines(disasmAround(buffer, item.offset, 12));
    setDisasmTitle(item.hexOffset);
    setDisasmVisible(true);
  };

  const saveFile = async () => {
    if (!buffer) {
      setInfoModal({
        title: "Нет файла",
        message: "Буфер пуст. Открой libapp.so заново.",
        actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
      });
      return;
    }
    if (patchedCount === 0) {
      setInfoModal({
        title: "Нет изменений",
        message: "Сначала сделай патч",
        actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
      });
      return;
    }
    setSaving(true);
    try {
      const base64 = uint8ToBase64(buffer);
      const outName = fileName
        ? fileName.replace(/\.so$/i, "") + "_patched.so"
        : "libapp_patched.so";
      const outUri = (FileSystem.cacheDirectory || "") + outName;
      await FileSystem.writeAsStringAsync(outUri, base64, { encoding: "base64" });
      markClean();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(outUri, {
          mimeType: "application/octet-stream",
          dialogTitle: "Сохранить патченый libapp.so",
        });
      }
    } catch (e: any) {
      setInfoModal({
        title: "Ошибка",
        message: e.message,
        actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
      });
    } finally {
      setSaving(false);
    }
  };

  const premium = actionItem && isPremiumKey(actionItem.matchedValue);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.count} selectable>
            {results.length > 0 ? `Найдено: ${results.length}` : fromApk ? "Из APK" : "Результаты"}
          </Text>
          {patchedCount > 0 && (
            <Text style={styles.patched} selectable>Патчей: {patchedCount}</Text>
          )}
          {fromApk && (
            <Text style={styles.fromApkHint} selectable>Патчи вернутся в APK при «Собрать»</Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={saveFile}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <Text style={styles.saveText} selectable>Сохранить</Text>
          )}
        </TouchableOpacity>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.offset.toString()}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        renderItem={({ item }) => (
          <ResultItem
            item={item}
            onToggle={() => handleSmartAction(item)}
            onCustomReplace={() => openCustom(item)}
            onToggleNearby={
              item.nearbyBool
                ? () => {
                    const next = toggleArm64Bool(item.nearbyBool!.hex);
                    if (next) {
                      applyPatch(
                        item.nearbyBool!.offset,
                        hexToBytes(next),
                        item.nearbyBool!.hex,
                        next,
                        "hex"
                      );
                    }
                  }
                : undefined
            }
            onBookmark={() => addBookmark(item)}
            onDisasm={() => showDisasm(item)}
            onManual={() =>
              navigatePatch(navigation, item.offset)
            }
            onCopyOffset={() => copyText("offset", item.hexOffset)}
            smartLabel={
              item.type === "string" && isPremiumKey(item.matchedValue)
                ? "Разблок"
                : item.type === "string"
                ? "Действие"
                : undefined
            }
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.empty} selectable>
              {fromApk
                ? "Файл из APK открыт.\nИщи строки (isPro / purchased) или HEX\nчерез кнопку «Назад» → Поиск,\nлибо используй «Быстрый unlock» на экране APK."
                : "Ничего не найдено"}
            </Text>
          </View>
        }
      />

      {/* Умный unlock — объяснение */}
      <AppModal
        visible={actionVisible}
        title={actionItem?.matchedValue || "Действие"}
        message={
          premium
            ? `Это имя проверки подписки/Pro (не значение true/false).\n\n` +
              `Чтобы открыть функцию, патчим машинный код рядом:\n` +
              `FALSE (00 00 80 52) → TRUE (20 00 80 52)\n\n` +
              `Найдено bool рядом: ${nearbyBools.length}` +
              (nearbyBools.length
                ? ` (false: ${nearbyBools.filter((b) => !b.isTrue).length}, true: ${nearbyBools.filter((b) => b.isTrue).length})`
                : " — нажми «Глубокий unlock»")
            : `Найдено bool рядом: ${nearbyBools.length}`
        }
        onClose={() => setActionVisible(false)}
        actions={[
          {
            label: "Разблокировать → TRUE",
            onPress: () => doUnlock(true, false),
          },
          {
            label: "Глубокий unlock (шире поиск)",
            variant: "outline",
            onPress: () => doUnlock(true, true),
          },
          {
            label: "Заблокировать → FALSE",
            variant: "outline",
            onPress: () => doUnlock(false, false),
          },
          {
            label: "Отмена",
            variant: "ghost",
            onPress: () => setActionVisible(false),
          },
        ]}
      />

      {/* Ручная замена */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle} selectable>Замена значения</Text>
            <Text style={styles.modalOffset} selectable>{currentItem?.hexOffset}</Text>
            {currentItem && isPremiumKey(currentItem.matchedValue) && (
              <Text style={styles.warn} selectable>
                ⚠ «{currentItem.matchedValue}» — имя проверки. Менять на true/false обычно бесполезно.
                Лучше закрой и нажми «Разблок».
              </Text>
            )}
            <Text style={styles.modalLabel} selectable>
              {currentItem?.type === "string" ? "Новая строка" : "Новый HEX"}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={customValue}
              onChangeText={setCustomValue}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={colors.textSecondary}
            />
            {suggestionsFor(currentItem).length > 0 && (
              <>
                <Text style={styles.modalLabel} selectable>На что заменить</Text>
                <View style={styles.chips}>
                  {suggestionsFor(currentItem).map((s) => (
                    <TouchableOpacity
                      key={s.label}
                      style={styles.chip}
                      onPress={() => setCustomValue(s.value)}
                    >
                      <Text style={styles.chipText} selectable>{s.label}</Text>
                      {!!s.hint && <Text style={styles.chipHint} selectable>{s.hint}</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelText} selectable>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalOk} onPress={applyCustom}>
                <Text style={styles.modalOkText} selectable>Применить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Дизасм */}
      <Modal visible={disasmVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle} selectable>Код {disasmTitle}</Text>
            <ScrollView style={{ maxHeight: 340 }}>
              {disasmLines.map((l) => (
                <Text
                  key={l.offset}
                  style={{ color: colors.text, fontFamily: "monospace", fontSize: 11, marginBottom: 4 }}
                 selectable>
                  {"0x" + l.offset.toString(16).toUpperCase().padStart(8, "0")} {l.hex}  {l.asm}
                </Text>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalOk, { marginTop: 16, alignSelf: "flex-end" }]}
              onPress={() => setDisasmVisible(false)}
            >
              <Text style={styles.modalOkText} selectable>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>


      <Modal visible={codeCandsVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { maxHeight: "85%" }]}>
            <Text style={styles.modalTitle} selectable>
              Код / регистры по строке
            </Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 12, lineHeight: 18 }} selectable>
              Bool рядом не найден — ниже кандидаты в .text (movz x0/w0 и xref).
              Manual = правка одного места. Не патчь все подряд.
            </Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {codeCands.map((c, i) => (
                <CandidateCard
                  key={c.offset + "-" + i}
                  item={c}
                  onDisasm={() => {
                    if (!buffer) return;
                    setDisasmTitle(c.hexOffset);
                    setDisasmLines(disasmAround(buffer, c.offset, 10));
                    setDisasmVisible(true);
                  }}
                  onManual={() => {
                    setCodeCandsVisible(false);
                    navigatePatch(navigation, c.offset);
                  }}
                  onTrue={
                    c.patchHex
                      ? async () => {
                          if (!buffer || !c.patchHex) return;
                          try {
                            const bytes = hexToBytes(c.patchHex.replace(/\s+/g, ""));
                            await applyPatch(c.offset, bytes, c.movzHex, c.patchHex, "hex");
                            setCodeCandsVisible(false);
                          } catch (e: any) {
                            setInfoModal({
                              title: "Ошибка патча",
                              message: e?.message || String(e),
                              actions: [{ label: "OK", onPress: () => setInfoModal(null) }],
                            });
                          }
                        }
                      : undefined
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
                            source: "results",
                          });
                          setInfoModal({
                            title: "В очереди",
                            message: c.hexOffset,
                            actions: [
                              {
                                label: "Очередь",
                                onPress: () => {
                                  setInfoModal(null);
                                  setCodeCandsVisible(false);
                                  navigateRoot(navigation, "Queue");
                                },
                              },
                              { label: "OK", variant: "ghost" as const, onPress: () => setInfoModal(null) },
                            ],
                          });
                        }
                      : undefined
                  }
                />
              ))}
            </ScrollView>
            <TouchableOpacity
              style={[styles.modalOk, { marginTop: 12, alignSelf: "stretch", alignItems: "center" }]}
              onPress={() => setCodeCandsVisible(false)}
            >
              <Text style={styles.modalOkText} selectable>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <AppModal
        visible={!!infoModal}
        title={infoModal?.title || ""}
        message={infoModal?.message}
        onClose={() => setInfoModal(null)}
        actions={infoModal?.actions}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  count: { color: colors.gold, fontWeight: "700", fontSize: 16 },
  patched: { color: colors.success, fontSize: 13, marginTop: 2 },
  fromApkHint: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  saveBtn: {
    backgroundColor: colors.gold,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    minWidth: 110,
    alignItems: "center",
  },
  saveText: { color: colors.onGold, fontWeight: "700", fontSize: 15 },
  emptyBox: { paddingHorizontal: 24, marginTop: 40 },
  empty: { color: colors.textSecondary, textAlign: "center", fontSize: 15, lineHeight: 22 },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: 24,
  },
  modal: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 16,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.borderGold,
  },
  modalTitle: { color: colors.goldLight, fontSize: 18, fontWeight: "800", marginBottom: 6 },
  modalOffset: { color: colors.textSecondary, fontFamily: "monospace", marginBottom: 12 },
  warn: {
    color: colors.warning,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
    backgroundColor: colors.surfaceLight,
    padding: 10,
    borderRadius: 8,
  },
  modalLabel: { color: colors.textSecondary, fontSize: 13, marginBottom: 6 },
  modalInput: {
    backgroundColor: colors.background,
    borderRadius: 12,
    padding: 14,
    color: colors.text,
    fontSize: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 18 },
  chip: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  chipText: { color: colors.gold, fontWeight: "700", fontSize: 13 },
  chipHint: { color: colors.textSecondary, fontSize: 10, marginTop: 2 },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 22,
  },
  cancelText: { color: colors.textSecondary, fontSize: 16 },
  modalOk: {
    backgroundColor: colors.gold,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 12,
  },
  modalOkText: { color: colors.onGold, fontWeight: "700", fontSize: 15 },
});
