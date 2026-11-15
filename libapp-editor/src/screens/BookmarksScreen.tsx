import React, { useState, useCallback } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, Alert,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { colors } from "../theme";
import { copyText } from "../utils/copyText";
import { Bookmark } from "../types";
import { loadBookmarks, saveBookmarks } from "../store/storage";

export default function BookmarksScreen({ navigation }: any) {
  const [list, setList] = useState<Bookmark[]>([]);

  const reload = async () => setList(await loadBookmarks());
  useFocusEffect(useCallback(() => { reload(); }, []));

  const remove = (id: string) => {
    Alert.alert("Удалить закладку?", "", [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          const next = list.filter((x) => x.id !== id);
          await saveBookmarks(next);
          setList(next);
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Закладки ({list.length})</Text>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Закладок нет.{"\n"}В результатах поиска нажми ★
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.offset}>{item.hexOffset}</Text>
            <Text style={styles.label}>{item.label}</Text>
            <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
              <TouchableOpacity onPress={() => copyText("offset", item.hexOffset)}>
                <Text style={{ color: colors.gold, fontWeight: "700", fontSize: 12 }}>Copy</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate("ManualPatch", { initialOffset: item.offset })}>
                <Text style={{ color: colors.gold, fontWeight: "700", fontSize: 12 }}>Manual</Text>
              </TouchableOpacity>
            </View>
            {!!item.fileName && <Text style={styles.meta}>{item.fileName}</Text>}
            <TouchableOpacity onPress={() => remove(item.id)}>
              <Text style={styles.delete}>Удалить</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { color: colors.gold, fontWeight: "700", fontSize: 17 },
  empty: { color: colors.textSecondary, textAlign: "center", marginTop: 60, lineHeight: 22 },
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: colors.border,
  },
  offset: { color: colors.gold, fontWeight: "700", fontFamily: "monospace", marginBottom: 4 },
  label: { color: colors.text, fontSize: 16, marginBottom: 4 },
  meta: { color: colors.textSecondary, fontSize: 12, marginBottom: 8 },
  delete: { color: colors.danger, fontSize: 13 },
});
