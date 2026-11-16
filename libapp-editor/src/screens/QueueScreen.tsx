import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from "react-native";
import * as FileSystem from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";
import { useAppFile } from "../store/AppContext";
import { applyQueueToBuffer } from "../domain/patchQueue";
import { uint8ToBase64 } from "../utils/binary";
import { addHistoryRecord } from "../store/storage";
import AppModal from "../components/AppModal";
import DeveloperFooter from "../components/DeveloperFooter";

export default function QueueScreen() {
  const {
    buffer,
    fileName,
    patchQueue,
    removePatch,
    clearQueue,
    updateBuffer,
    markClean,
    enqueuePatch,
    revertToOriginal,
    dirty,
    fingerprint,
  } = useAppFile();
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<{ title: string; message: string } | null>(null);

  const applyAll = async () => {
    if (!buffer) {
      setModal({ title: "Нет so", message: "Открой файл" });
      return;
    }
    if (patchQueue.length === 0) {
      setModal({ title: "Пусто", message: "Очередь пуста" });
      return;
    }
    setLoading(true);
    try {
      const { buffer: next, applied, errors } = applyQueueToBuffer(buffer, patchQueue);
      updateBuffer(next);
      for (const p of patchQueue) {
        try {
          await addHistoryRecord({
            offset: p.offset,
            hexOffset: p.hexOffset,
            oldValue: p.oldHex,
            newValue: p.newHex,
            type: "hex",
            note: p.note || "queue",
            fingerprint: fingerprint || undefined,
          });
        } catch {
          /* */
        }
      }
      clearQueue();
      setModal({
        title: "Очередь применена",
        message: `Патчей: ${applied}${errors.length ? "\nОшибки:\n" + errors.join("\n") : ""}\nСохрани so.`,
      });
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!buffer) return;
    setLoading(true);
    try {
      const name = (fileName || "libapp.so").replace(/\.so$/i, "") + "_patched.so";
      const path = (FileSystem.cacheDirectory || "") + name;
      await FileSystem.writeAsStringAsync(path, uint8ToBase64(buffer), { encoding: "base64" });
      markClean();
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
      setModal({ title: "Сохранено", message: name });
    } catch (e: any) {
      setModal({ title: "Ошибка", message: e?.message || String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={patchQueue}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <View>
            <Text style={styles.title} selectable>
              Очередь патчей
            </Text>
            <Text style={styles.sub} selectable>
              Несколько offset → применить разом → сохранить so. Не мешай data и .text без нужды.
            </Text>
            <View style={styles.row}>
              <TouchableOpacity style={styles.btn} onPress={applyAll} disabled={loading}>
                {loading ? (
                  <ActivityIndicator color={colors.onGold} />
                ) : (
                  <Text style={styles.btnText} selectable>
                    Применить все ({patchQueue.length})
                  </Text>
                )}
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.btnOutline} onPress={save} disabled={!buffer}>
              <Text style={styles.btnOutlineText} selectable>
                Сохранить / Share .so
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.btnOutline}
              onPress={async () => {
                try {
                  const res = await DocumentPicker.getDocumentAsync({
                    type: ["application/json", "text/plain", "*/*"],
                    copyToCacheDirectory: true,
                  });
                  if (res.canceled || !res.assets?.[0]) return;
                  const raw = await FileSystem.readAsStringAsync(res.assets[0].uri, {
                    encoding: "utf8",
                  });
                  const data = JSON.parse(raw);
                  const list = Array.isArray(data) ? data : data.patches || data.queue || [];
                  let n = 0;
                  for (const item of list) {
                    const offset =
                      typeof item.offset === "number"
                        ? item.offset
                        : parseInt(String(item.hexOffset || item.offset || "0"), 0);
                    const newHex = item.newHex || item.hex || item.replace;
                    if (!newHex || isNaN(offset)) continue;
                    enqueuePatch({
                      offset,
                      hexOffset:
                        item.hexOffset ||
                        "0x" + offset.toString(16).toUpperCase().padStart(8, "0"),
                      oldHex: item.oldHex || "",
                      newHex: String(newHex),
                      note: item.note || "import",
                      source: "json",
                    });
                    n++;
                  }
                  setModal({ title: "Import", message: `Добавлено в очередь: ${n}` });
                } catch (e: any) {
                  setModal({ title: "Ошибка import", message: e?.message || String(e) });
                }
              }}
            >
              <Text style={styles.btnOutlineText} selectable>
                Import JSON
              </Text>
            </TouchableOpacity>
            {patchQueue.length > 0 && (
              <TouchableOpacity
                style={styles.btnOutline}
                onPress={async () => {
                  const body = JSON.stringify(patchQueue, null, 2);
                  const path = (FileSystem.cacheDirectory || "") + "patch_queue.json";
                  await FileSystem.writeAsStringAsync(path, body, { encoding: "utf8" });
                  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
                  else setModal({ title: "Export", message: path });
                }}
              >
                <Text style={styles.btnOutlineText} selectable>
                  Export JSON
                </Text>
              </TouchableOpacity>
            )}
            {dirty && (
              <TouchableOpacity
                style={styles.btnGhost}
                onPress={() => {
                  if (revertToOriginal())
                    setModal({
                      title: "Откат",
                      message: "Buffer восстановлен из original (сессия). Очередь очищена.",
                    });
                  else setModal({ title: "Нет original", message: "Открой so заново" });
                }}
              >
                <Text style={styles.btnGhostText} selectable>
                  Откат к original
                </Text>
              </TouchableOpacity>
            )}
            {patchQueue.length > 0 && (
              <TouchableOpacity style={styles.btnGhost} onPress={clearQueue}>
                <Text style={styles.btnGhostText} selectable>
                  Очистить очередь
                </Text>
              </TouchableOpacity>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty} selectable>
            Очередь пуста. Добавляй из Manual («В очередь») или кандидатов.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.item}>
            <Text style={styles.off} selectable>
              {item.hexOffset}
            </Text>
            <Text style={styles.meta} selectable>
              {item.oldHex || "?"} → {item.newHex}
            </Text>
            {!!item.note && (
              <Text style={styles.meta} selectable>
                {item.note}
              </Text>
            )}
            <TouchableOpacity onPress={() => removePatch(item.id)}>
              <Text style={styles.remove} selectable>
                Убрать
              </Text>
            </TouchableOpacity>
          </View>
        )}
        ListFooterComponent={<DeveloperFooter />}
      />
      <AppModal
        visible={!!modal}
        title={modal?.title || ""}
        message={modal?.message}
        onClose={() => setModal(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  title: { color: colors.goldLight, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.textSecondary, marginVertical: 10, lineHeight: 19, fontSize: 13 },
  row: { marginBottom: 10 },
  btn: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: colors.onGold, fontWeight: "800", fontSize: 15 },
  btnOutline: {
    borderWidth: 1.5,
    borderColor: colors.borderGold,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  btnOutlineText: { color: colors.gold, fontWeight: "700" },
  btnGhost: { padding: 12, alignItems: "center" },
  btnGhostText: { color: colors.textSecondary },
  empty: { color: colors.textSecondary, textAlign: "center", marginTop: 24, lineHeight: 20 },
  item: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  off: { color: colors.goldLight, fontFamily: "monospace", fontWeight: "800" },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  remove: { color: colors.danger, fontWeight: "700", marginTop: 10 },
});
