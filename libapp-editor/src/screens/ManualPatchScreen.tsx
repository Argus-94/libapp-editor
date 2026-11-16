import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRoute, useNavigation } from "@react-navigation/native";
import { colors } from "../theme";
import { logger } from "../utils/logger";
import { useAppFile } from "../store/AppContext";
import { disasmAt, toggleBoolAt, patchBytesAt } from "../utils/analyze";
import { bufferToHex, uint8ToBase64 } from "../utils/binary";
import { addHistoryRecord } from "../store/storage";
import { copyText, formatOffset } from "../utils/copyText";
import AppModal from "../components/AppModal";
import DeveloperFooter from "../components/DeveloperFooter";
import { patchZone, zoneMessage } from "../domain/textGuard";
import { hexDiffWindow } from "../domain/patchDiff";
import { navigateRoot } from "../utils/nav";


function parseOffset(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (s.startsWith("0x")) return parseInt(s, 16);
  if (/^[0-9a-f]+$/i.test(s) && /[a-f]/i.test(s)) return parseInt(s, 16);
  return parseInt(s, 10);
}

export default function ManualPatchScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { buffer, fileName, updateBuffer, textRange, enqueuePatch, patchQueue, dirty, markClean, fingerprint } = useAppFile();
  const [offsetStr, setOffsetStr] = useState("");
  const [hexStr, setHexStr] = useState("");
  const [disasm, setDisasm] = useState<{ hexOffset: string; hex: string; asm: string; isCenter?: boolean }[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ title: string; message: string; actions?: any } | null>(null);

  useEffect(() => {
    const initial = route.params?.initialOffset;
    if (initial === undefined || initial === null) return;
    const n = typeof initial === "number" ? initial : parseOffset(String(initial));
    if (!isNaN(n)) {
      setOffsetStr(formatOffset(n));
      if (buffer) {
        setDisasm(disasmAt(buffer, n, 24));
        setLog((l) => [`from nav @ ${formatOffset(n)}`, ...l].slice(0, 40));
      }
    }
  }, [route.params?.initialOffset, buffer]);

  const showAround = () => {
    if (!buffer) {
      setModal({ title: "Нет файла", message: "Открой libapp.so" });
      return;
    }
    const off = parseOffset(offsetStr);
    if (isNaN(off) || off < 0 || off >= buffer.length) {
      setModal({ title: "Offset", message: "Некорректный offset" });
      return;
    }
    setDisasm(disasmAt(buffer, off, 24));
    setLog((l) => [`preview @ 0x${off.toString(16)}  ${bufferToHex(buffer, off, 4)}`, ...l].slice(0, 40));
  };

  const doToggleBool = async () => {
    if (!buffer) return;
    const off = parseOffset(offsetStr);
    if (isNaN(off)) {
      setModal({ title: "Offset", message: "Укажи offset" });
      return;
    }
    const res = toggleBoolAt(buffer, off);
    if (!res) {
      setModal({
        title: "Не bool movz",
        message: `На 0x${off.toString(16)} нет movz x0/w0 #0/#1\nСейчас: ${bufferToHex(buffer, off, 4)}`,
      });
      return;
    }
    updateBuffer(res.buffer);
    setDisasm(disasmAt(res.buffer, off, 14));
    setLog((l) => [`TOGGLE ${res.oldHex} → ${res.newHex} @ 0x${off.toString(16)}`, ...l].slice(0, 40));
    logger.info("Manual", "patch", { offset: offsetStr });
    await addHistoryRecord({
      offset: off,
      hexOffset: "0x" + off.toString(16).toUpperCase(),
      oldValue: res.oldHex,
      newValue: res.newHex,
      type: "hex",
      note: "manual toggle bool",
      fingerprint: fingerprint || undefined,
    });
    const diff = hexDiffWindow(buffer, res.buffer, off, 8);
    setModal({ title: "Патч", message: `${res.oldHex} → ${res.newHex}\n\n${diff}` });
  };

  const doWriteHex = async () => {
    if (!buffer) return;
    const off = parseOffset(offsetStr);
    if (isNaN(off)) {
      setModal({ title: "Offset", message: "Укажи offset" });
      return;
    }
    const zone = patchZone(off, textRange);
    if (zone === "data") {
      setModal({
        title: "Offset в data",
        message:
          zoneMessage(zone) +
          "\n\nЗапись в data редко открывает Pro и может сломать so.\nЧтобы всё равно записать — ещё раз нажми «Записать HEX» после смены offset в .text или подтверди ниже.",
        actions: [
          { label: "Отмена", variant: "ghost" as const, onPress: () => setModal(null) },
          {
            label: "Всё равно записать",
            variant: "danger" as const,
            onPress: () => {
              setModal(null);
              void writeHexForce(off);
            },
          },
        ],
      });
      return;
    }
    await writeHexForce(off);
  };

  const writeHexForce = async (off: number) => {
    if (!buffer) return;
    setLoading(true);
    try {
      const res = patchBytesAt(buffer, off, hexStr);
      const diff = hexDiffWindow(buffer, res.buffer, off, 8);
      updateBuffer(res.buffer);
      setDisasm(disasmAt(res.buffer, off, 14));
      setLog((l) => [`WRITE ${res.oldHex} → ${res.newHex} @ 0x${off.toString(16)}`, ...l].slice(0, 40));
      await addHistoryRecord({
        offset: off,
        hexOffset: "0x" + off.toString(16).toUpperCase(),
        oldValue: res.oldHex,
        newValue: res.newHex,
        type: "hex",
        note: "manual write",
        fingerprint: fingerprint || undefined,
      });
      // session dirty/fp already updated via updateBuffer → persistSession
      setModal({ title: "Записано", message: `${res.oldHex} → ${res.newHex}\n\n${diff}` });
    } catch (e: any) {
      setModal({ title: "Ошибка", message: e.message });
    } finally {
      setLoading(false);
    }
  };

  const saveFile = async () => {
    if (!buffer) return;
    const b64 = uint8ToBase64(buffer);
    const out =
      (FileSystem.cacheDirectory || "") +
      (fileName || "libapp").replace(/\.so$/i, "") +
      "_manual.so";
    await FileSystem.writeAsStringAsync(out, b64, { encoding: "base64" });
    markClean();
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(out, { mimeType: "application/octet-stream" });
    }
    setModal({ title: "Сохранено", message: out.split("/").pop() || "so" });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      
      <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 10, paddingHorizontal: 4 }} selectable>Шаг 3: offset из Code candidates (Analyze), не из строк isPro. HEX: 00 00 80 D2 → 20 00 80 D2</Text>
<Text style={styles.title} selectable>Manual Patch</Text>
      <Text style={styles.sub} selectable>
        {buffer ? fileName || "в памяти" : "Нет файла — открой на «Поиск»"}
        {dirty ? " · dirty" : ""}
      </Text>
      {patchQueue.length > 0 && (
        <TouchableOpacity
          style={{
            alignSelf: "flex-start",
            backgroundColor: colors.goldSoft,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 8,
            marginBottom: 10,
            borderWidth: 1,
            borderColor: colors.borderGold,
          }}
          onPress={() => navigateRoot(navigation, "Queue")}
        >
          <Text style={{ color: colors.gold, fontWeight: "800", fontSize: 13 }} selectable>
            Очередь ({patchQueue.length}) →
          </Text>
        </TouchableOpacity>
      )}
      <Text style={styles.hint} selectable>
        Один offset за раз. Offset из Analyze / R2Droid. Не используй массовый auto на рискованных SO.
      </Text>

      <Text style={styles.label} selectable>Offset (hex или dec)</Text>
      <TextInput
        style={styles.input}
        value={offsetStr}
        onChangeText={setOffsetStr}
        placeholder="0x4C4A64 или 5000804"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <TouchableOpacity style={styles.mainBtn} onPress={showAround} disabled={!buffer}>
        <Text style={styles.mainText} selectable>Показать disasm</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.warnBtn} onPress={doToggleBool} disabled={!buffer}>
        <Text style={styles.mainText} selectable>Toggle movz bool (0↔1) #0 ↔ #1</Text>
      </TouchableOpacity>

      <Text style={styles.label} selectable>Записать произвольный hex</Text>
      <TextInput
        style={styles.input}
        value={hexStr}
        onChangeText={setHexStr}
        placeholder="20 00 80 D2"
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <TouchableOpacity style={styles.secBtn} onPress={doWriteHex} disabled={!buffer || loading}>
        {loading ? <ActivityIndicator color={colors.gold} /> : <Text style={styles.secText} selectable>Write bytes</Text>}
      </TouchableOpacity>

      {disasm.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.section} selectable>Disasm</Text>
          {disasm.map((l, i) => (
            <Text key={i} style={[styles.mono, l.isCenter && { color: colors.gold }]} selectable>
              {l.hexOffset}  {l.hex}  {l.asm}
            </Text>
          ))}
        </View>
      )}

      {log.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.section} selectable>Log</Text>
          {log.map((x, i) => (
            <Text key={i} style={styles.mono} selectable>{x}</Text>
          ))}
        </View>
      )}

      <Text style={styles.label} selectable>Шаблоны ARM64</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {[
          { label: "x0=1", hex: "20 00 80 D2" },
          { label: "x0=0", hex: "00 00 80 D2" },
          { label: "w0=1", hex: "20 00 80 52" },
          { label: "w0=0", hex: "00 00 80 52" },
          { label: "ret", hex: "C0 03 5F D6" },
          { label: "nop", hex: "1F 20 03 D5" },
        ].map((t) => (
          <TouchableOpacity
            key={t.label}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.borderGold,
            }}
            onPress={() => setHexStr(t.hex)}
          >
            <Text style={{ color: colors.gold, fontWeight: "700", fontSize: 12 }} selectable>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity
        style={styles.secBtn}
        onPress={() => {
          const off = parseOffset(offsetStr);
          if (isNaN(off) || !hexStr.trim()) {
            setModal({ title: "Очередь", message: "Нужны offset и hex" });
            return;
          }
          const zone = patchZone(off, textRange);
          enqueuePatch({
            offset: off,
            hexOffset: formatOffset(off),
            oldHex: buffer ? bufferToHex(buffer, off, Math.ceil(hexStr.replace(/\s+/g, "").length / 2)) : "",
            newHex: hexStr.trim(),
            note: zoneMessage(zone),
            source: "manual",
          });
          setModal({
            title: "В очереди",
            message: `${formatOffset(off)} → ${hexStr.trim()}\n${zoneMessage(zone)}\nВсего в очереди: ${patchQueue.length + 1}`,
          });
        }}
      >
        <Text style={styles.secText} selectable>В очередь патчей ({patchQueue.length})</Text>
      </TouchableOpacity>

      {!!offsetStr && (
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8, lineHeight: 17 }} selectable>
          {(() => {
            const off = parseOffset(offsetStr);
            if (isNaN(off)) return "";
            return zoneMessage(patchZone(off, textRange));
          })()}
          {dirty ? " · есть несохранённые изменения" : ""}
        </Text>
      )}

      <TouchableOpacity style={[styles.secBtn, { marginTop: 12 }]} onPress={saveFile} disabled={!buffer}>
        <Text style={styles.secText} selectable>Сохранить / Share .so</Text>
      </TouchableOpacity>

      <View style={{ marginTop: 16, padding: 12, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.gold, fontWeight: "700", marginBottom: 6 }} selectable>Разблок HEX</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, fontFamily: "monospace", lineHeight: 18 }} selectable>
            00 00 80 D2 → 20 00 80 D2  (x0 false→true){"\n"}
            00 00 80 52 → 20 00 80 52  (w0 false→true){"\n"}
            C0 03 5F D6 = ret
          </Text>
        </View>
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
  title: { color: colors.gold, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.textSecondary, marginTop: 4, marginBottom: 8 },
  hint: { color: colors.textSecondary, fontSize: 13, marginBottom: 16, lineHeight: 18 },
  label: { color: colors.gold, fontWeight: "600", marginBottom: 6, marginTop: 8 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, color: colors.text,
    borderWidth: 1, borderColor: colors.border, marginBottom: 12, fontFamily: "monospace",
  },
  mainBtn: {
    backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 16, minHeight: 48, alignItems: "center", justifyContent: "center", marginBottom: 10,
  },
  warnBtn: {
    backgroundColor: colors.dangerDark, borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 10,
  },
  mainText: { color: colors.onGold, fontWeight: "800" },
  secBtn: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, alignItems: "center",
    borderWidth: 1, borderColor: colors.border, marginBottom: 10,
  },
  secText: { color: colors.gold, fontWeight: "700" },
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginTop: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  section: { color: colors.gold, fontWeight: "700", marginBottom: 6 },
  mono: { color: colors.textSecondary, fontFamily: "monospace", fontSize: 11, lineHeight: 16 },
});
