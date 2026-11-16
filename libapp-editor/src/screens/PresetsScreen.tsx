import { navigateRoot } from "../utils/nav";
import React, { useState, useCallback } from "react";
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";
import { useDialog } from "../components/DialogProvider";
import { PatchPreset } from "../types";
import { loadPresets, savePresets, addHistoryRecord } from "../store/storage";
import { useAppFile } from "../store/AppContext";
import { applyPatches, uint8ToBase64 } from "../utils/binary";

export default function PresetsScreen({ navigation }: any) {
  const dialog = useDialog();
  const { buffer, fileName, updateBuffer, fingerprint } = useAppFile();
  const [list, setList] = useState<PatchPreset[]>([]);

  const reload = async () => setList(await loadPresets());
  useFocusEffect(useCallback(() => { reload(); }, []));

  const remove = (id: string) => {
    dialog.confirm(
      "Удалить пресет?",
      "Убрать пресет из списка",
      async () => {
        const next = list.filter((x) => x.id !== id);
        await savePresets(next);
        setList(next);
      },
      "Удалить",
      true
    );
  };

  const applyPreset = (preset: PatchPreset) => {
    if (!buffer) {
      dialog.alert("Нет открытого файла", "Сначала открой libapp.so на вкладке «Поиск».");
      return;
    }

    dialog.alert(
      "Применить пресет?",
      `"${preset.name}" → ${fileName || "libapp.so"}\nЗамен: ${preset.patches.length}`,
      [
        { text: "Отмена", style: "cancel" },
        {
          text: "Применить",
          onPress: async () => {
            try {
              const result = applyPatches(
                buffer,
                preset.patches.map((p) => ({
                  search: p.search,
                  searchType: p.searchType,
                  replace: p.replace,
                  replaceType: p.replaceType,
                  maxOccurrences: 40,
                }))
              );
              updateBuffer(result.buffer);

              for (const d of result.details) {
                if (d.count > 0) {
                  await addHistoryRecord({
                    offset: 0,
                    hexOffset: "preset",
                    oldValue: d.search,
                    newValue: `(x${d.count})`,
                    type: "hex",
                    note: preset.name,
                    fingerprint: fingerprint || undefined,
                  });
                }
              }

              const summary = result.details
                .map((d) => `${d.search}: ${d.count}`)
                .join("\n");

              dialog.alert(
                "Пресет применён",
                `Всего замен: ${result.applied}\n\n${summary}`,
                [
                  { text: "OK" },
                  {
                    text: "Сохранить файл",
                    onPress: async () => {
                      const b64 = uint8ToBase64(result.buffer);
                      const out =
                        (FileSystem.cacheDirectory || "") +
                        (fileName || "libapp").replace(/\.so$/i, "") +
                        "_patched.so";
                      await FileSystem.writeAsStringAsync(out, b64, {
                        encoding: "base64",
                      });
                      if (await Sharing.isAvailableAsync()) {
                        await Sharing.shareAsync(out, {
                          mimeType: "application/octet-stream",
                        });
                      }
                    },
                  },
                ]
              );
            } catch (e: any) {
              dialog.alert("Ошибка", e.message);
            }
          },
        },
      ]
    );
  };

  const exportPresets = async () => {
    try {
      const json = JSON.stringify(list, null, 2);
      const uri = (FileSystem.cacheDirectory || "") + "libapp_presets.json";
      await FileSystem.writeAsStringAsync(uri, json, { encoding: "utf8" });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: "application/json",
          dialogTitle: "Экспорт пресетов",
        });
      } else {
        dialog.alert("Сохранено", uri);
      }
    } catch (e: any) {
      dialog.alert("Ошибка экспорта", e.message);
    }
  };

  const importPresets = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const text = await FileSystem.readAsStringAsync(res.assets[0].uri, {
        encoding: "utf8",
      });
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        dialog.alert("Неверный формат", "Ожидался массив пресетов");
        return;
      }
      const merged = [...parsed, ...list];
      // dedupe by id
      const map = new Map<string, PatchPreset>();
      for (const p of merged) {
        if (p && p.id && p.name) map.set(p.id, p);
      }
      const next = Array.from(map.values());
      await savePresets(next);
      setList(next);
      dialog.alert("Импорт", `Загружено. Всего пресетов: ${next.length}`);
    } catch (e: any) {
      dialog.alert("Ошибка импорта", e.message);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <View>
          <Text style={styles.title} selectable>Пресеты ({list.length})</Text>
          <Text style={styles.fileHint} selectable>
            {buffer ? `Файл: ${fileName}` : "Файл не открыт"}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigateRoot(navigation, "PresetEdit", {})}
        >
          <Text style={styles.addText} selectable>+ Новый</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tools}>
        <TouchableOpacity style={styles.toolBtn} onPress={exportPresets}>
          <Text style={styles.toolText} selectable>Экспорт</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.toolBtn} onPress={importPresets}>
          <Text style={styles.toolText} selectable>Импорт</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={<Text style={styles.empty} selectable>Пресетов пока нет</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.name} selectable>{item.name}</Text>
            {!!item.description && <Text style={styles.desc} selectable>{item.description}</Text>}
            <Text style={styles.meta} selectable>
              {item.patches.map((p) => p.search).join(" · ") || "пусто"}
            </Text>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.applyBtn} onPress={() => applyPreset(item)}>
                <Text style={styles.applyText} selectable>Применить</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => navigateRoot(navigation, "PresetEdit", { presetId: item.id })}
              >
                <Text style={styles.edit} selectable>Изменить</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => remove(item.id)}>
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
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { color: colors.gold, fontWeight: "700", fontSize: 17 },
  fileHint: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  addBtn: {
    backgroundColor: colors.gold,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  addText: { color: colors.onGold, fontWeight: "700" },
  tools: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 12 },
  toolBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  toolText: { color: colors.gold, fontWeight: "600" },
  empty: { color: colors.textSecondary, textAlign: "center", marginTop: 60 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { color: colors.text, fontWeight: "700", fontSize: 16, marginBottom: 4 },
  desc: { color: colors.textSecondary, marginBottom: 6 },
  meta: { color: colors.gold, fontSize: 12, marginBottom: 10 },
  actions: { flexDirection: "row", alignItems: "center", gap: 14 },
  applyBtn: {
    backgroundColor: colors.gold,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  applyText: { color: colors.onGold, fontWeight: "700", fontSize: 13 },
  edit: { color: colors.gold, fontSize: 13, fontWeight: "600" },
  delete: { color: colors.danger, fontSize: 13 },
});
