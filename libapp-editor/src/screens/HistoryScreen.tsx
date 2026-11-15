import React, { useState, useCallback } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { colors } from "../theme";
import { copyText } from "../utils/copyText";
import { logger } from "../utils/logger";
import { PatchRecord } from "../types";
import { loadHistory, saveHistory } from "../store/storage";

export default function HistoryScreen({ navigation }: any) {
  const [list, setList] = useState<PatchRecord[]>([]);

  const reload = async () => {
    setList(await loadHistory());
  };

  useFocusEffect(useCallback(() => { reload(); }, []));

  const clearAll = () => {
    Alert.alert("Очистить историю?", "Все записи будут удалены", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Очистить",
        style: "destructive",
        onPress: async () => {
          await saveHistory([]);
          setList([]);
        },
      },
    ]);
  };

  const removeOne = async (id: string) => {
    const next = list.filter((x) => x.id !== id);
    await saveHistory(next);
    setList(next);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title} selectable>История патчей ({list.length})</Text>
        {list.length > 0 && (
          <TouchableOpacity onPress={clearAll}>
            <Text style={styles.clear} selectable>Очистить</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <Text style={styles.empty} selectable>История пуста. Сделай патч — он появится здесь.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.offset} selectable>{item.hexOffset}</Text>
              <Text style={styles.time} selectable>
                {new Date(item.timestamp).toLocaleString()}
              </Text>
            </View>
            <Text style={styles.change} selectable>
              <Text style={styles.old} selectable>{item.oldValue}</Text>
              {(item.note || (item as any).fingerprint) ? (
                <Text style={{ color: colors.textSecondary, fontSize: 11, marginTop: 4 }} selectable>
                  {item.note || ""}{(item as any).fingerprint ? ` · fp ${(item as any).fingerprint}` : ""}
                </Text>
              ) : null}
              {"  →  "}
              <Text style={styles.new} selectable>{item.newValue}</Text>
            </Text>
            <View style={styles.row}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <TouchableOpacity onPress={() => copyText("offset", item.hexOffset)}>
                  <Text style={{ color: colors.gold, fontWeight: "700", fontSize: 12 }} selectable>Copy</Text>
                </TouchableOpacity>
                {item.offset > 0 && (
                  <TouchableOpacity onPress={() => navigation.navigate("ManualPatch", { initialOffset: item.offset })}>
                    <Text style={{ color: colors.gold, fontWeight: "700", fontSize: 12 }} selectable>Manual</Text>
                  </TouchableOpacity>
                )}
                <Text style={styles.type} selectable>{item.type}</Text>
              </View>
              <TouchableOpacity onPress={() => removeOne(item.id)}>
                <Text style={styles.delete} selectable>Удалить</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { color: colors.gold, fontWeight: "700", fontSize: 17 },
  clear: { color: colors.danger, fontWeight: "600" },
  empty: { color: colors.textSecondary, textAlign: "center", marginTop: 60, paddingHorizontal: 20 },
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: colors.border,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  offset: { color: colors.gold, fontWeight: "700", fontFamily: "monospace" },
  time: { color: colors.textSecondary, fontSize: 12 },
  change: { color: colors.text, fontSize: 15, marginBottom: 8 },
  old: { color: colors.danger },
  new: { color: colors.success },
  type: { color: colors.textSecondary, fontSize: 12 },
  delete: { color: colors.danger, fontSize: 13 },
});
