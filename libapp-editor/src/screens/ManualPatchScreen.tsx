import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRoute } from "@react-navigation/native";
import { colors } from "../theme";
import { logger } from "../utils/logger";
import { useAppFile } from "../store/AppContext";
import { disasmAt, toggleBoolAt, patchBytesAt } from "../utils/analyze";
import { bufferToHex, uint8ToBase64 } from "../utils/binary";
import { addHistoryRecord } from "../store/storage";
import { copyText, formatOffset } from "../utils/copyText";
import AppModal from "../components/AppModal";
import DeveloperFooter from "../components/DeveloperFooter";

function parseOffset(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (s.startsWith("0x")) return parseInt(s, 16);
  if (/^[0-9a-f]+$/i.test(s) && /[a-f]/i.test(s)) return parseInt(s, 16);
  return parseInt(s, 10);
}

export default function ManualPatchScreen() {
  const route = useRoute<any>();
  const { buffer, fileName, updateBuffer } = useAppFile();
  const [offsetStr, setOffsetStr] = useState("");
  const [hexStr, setHexStr] = useState("");
  const [disasm, setDisasm] = useState<{ hexOffset: string; hex: string; asm: string; isCenter?: boolean }[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ title: string; message: string } | null>(null);

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
    });
    setModal({ title: "Патч", message: `${res.oldHex} → ${res.newHex}` });
  };

  const doWriteHex = async () => {
    if (!buffer) return;
    const off = parseOffset(offsetStr);
    if (isNaN(off)) {
      setModal({ title: "Offset", message: "Укажи offset" });
      return;
    }
    setLoading(true);
    try {
      const res = patchBytesAt(buffer, off, hexStr);
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
      });
      setModal({ title: "Записано", message: `${res.oldHex} → ${res.newHex}` });
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
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(out, { mimeType: "application/octet-stream" });
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      
      <Text style={{ color: "#AAAAAA", fontSize: 12, marginBottom: 10, paddingHorizontal: 4 }} selectable>Шаг 3: offset из Code candidates (Analyze), не из строк isPro. HEX: 00 00 80 D2 → 20 00 80 D2</Text>
<Text style={styles.title} selectable>Manual Patch</Text>
      <Text style={styles.sub} selectable>
        {buffer ? fileName || "в памяти" : "Нет файла — открой на «Поиск»"}
      </Text>
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
    backgroundColor: "#C0392B", borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 10,
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
