import React, { useState } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";
import { base64ToUint8, compareBuffers, DiffItem } from "../utils/binary";
import { diffToMarkdown } from "../utils/report";
import { useAppFile } from "../store/AppContext";
import { logger } from "../utils/logger";

export default function CompareScreen() {
  const { buffer, fileName, backupUri } = useAppFile();
  const [nameA, setNameA] = useState("");
  const [nameB, setNameB] = useState("");
  const [bufA, setBufA] = useState<Uint8Array | null>(null);
  const [bufB, setBufB] = useState<Uint8Array | null>(null);
  const [diffs, setDiffs] = useState<DiffItem[]>([]);
  const [loading, setLoading] = useState(false);


  const loadCurrent = () => {
    if (!buffer) {
      Alert.alert("Нет so", "Открой libapp.so на Поиск");
      return;
    }
    setNameA(fileName || "current.so");
    setBufA(buffer);
    setDiffs([]);
    logger.info("Compare", "loaded current buffer");
  };

  const loadBackup = async () => {
    if (!backupUri) {
      Alert.alert("Нет backup", "Включи автобэкап и открой so заново");
      return;
    }
    try {
      setLoading(true);
      const base64 = await FileSystem.readAsStringAsync(backupUri, { encoding: "base64" });
      const bytes = base64ToUint8(base64);
      setNameB((fileName || "libapp.so") + ".bak");
      setBufB(bytes);
      setDiffs([]);
      logger.info("Compare", "loaded backup", { backupUri });
    } catch (e: any) {
      Alert.alert("Ошибка backup", e.message);
    } finally {
      setLoading(false);
    }
  };

  const pick = async (which: "a" | "b") => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setLoading(true);
      const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: "base64" });
      const bytes = base64ToUint8(base64);
      if (which === "a") {
        setNameA(asset.name);
        setBufA(bytes);
      } else {
        setNameB(asset.name);
        setBufB(bytes);
      }
      setDiffs([]);
      setLoading(false);
    } catch (e: any) {
      setLoading(false);
      Alert.alert("Ошибка", e.message);
    }
  };

  // UI helpers above return

  const runCompare = () => {
    if (!bufA || !bufB) {
      Alert.alert("Выбери оба файла");
      return;
    }
    setLoading(true);
    setTimeout(() => {
      const result = compareBuffers(bufA, bufB);
      setDiffs(result);
      setLoading(false);
      if (result.length === 0) {
        Alert.alert("Файлы идентичны", "Различий не найдено");
      }
    }, 30);
  };

  return (
    <View style={styles.container}>
      <View style={styles.pickers}>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
          <TouchableOpacity style={[styles.pickBtn, { flex: 1 }]} onPress={loadCurrent}>
            <Text style={styles.pickText} selectable>A: текущий so</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.pickBtn, { flex: 1 }]} onPress={loadBackup}>
            <Text style={styles.pickText} selectable>B: backup</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.pickBtn} onPress={() => pick("a")}>
          <Text style={styles.pickText} selectable>{nameA || "Файл A (оригинал)"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.pickBtn} onPress={() => pick("b")}>
          <Text style={styles.pickText} selectable>{nameB || "Файл B (патченый)"}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.compareBtn} onPress={runCompare} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.compareText} selectable>Сравнить</Text>
          )}
        </TouchableOpacity>
      </View>

      {diffs.length > 0 && (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <Text style={styles.summary} selectable>Найдено отличий: {diffs.length}</Text>
          <TouchableOpacity
            style={styles.exportBtn}
            onPress={async () => {
              if (!bufA || !bufB) return;
              const md = diffToMarkdown(nameA || "A", nameB || "B", diffs, bufA.length, bufB.length);
              const path = (FileSystem.cacheDirectory || "") + "so_diff.md";
              await FileSystem.writeAsStringAsync(path, md, { encoding: "utf8" });
              if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
            }}
          >
            <Text style={styles.exportText} selectable>Export diff MD</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={diffs}
        keyExtractor={(item) => item.offset.toString()}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.offset} selectable>{item.hexOffset}</Text>
            <Text style={styles.old} selectable>− {item.oldHex}</Text>
            <Text style={styles.new} selectable>+ {item.newHex}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  pickers: { padding: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  pickBtn: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  pickText: { color: colors.text, textAlign: "center" },
  compareBtn: {
    backgroundColor: colors.gold, borderRadius: 12, padding: 14, alignItems: "center", marginTop: 4,
  },
  compareText: { color: colors.onGold, fontWeight: "800", fontSize: 16 },
  summary: { color: colors.gold, fontWeight: "700", marginBottom: 8 },
  exportBtn: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 10, alignItems: "center",
    borderWidth: 1, borderColor: colors.border, marginBottom: 4,
  },
  exportText: { color: colors.gold, fontWeight: "700", fontSize: 13 },
  card: {
    backgroundColor: colors.surface, borderRadius: 10, padding: 12,
    marginBottom: 8, borderWidth: 1, borderColor: colors.border,
  },
  offset: { color: colors.gold, fontWeight: "700", fontFamily: "monospace", marginBottom: 6 },
  old: { color: colors.danger, fontFamily: "monospace", fontSize: 13 },
  new: { color: colors.success, fontFamily: "monospace", fontSize: 13 },
});
