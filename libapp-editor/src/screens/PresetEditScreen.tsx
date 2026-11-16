import { useDialog } from "../components/DialogProvider";
import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, FlatList, Switch,
} from "react-native";
import { colors } from "../theme";
import { PatchPreset } from "../types";
import { loadPresets, savePresets } from "../store/storage";

type PatchLine = PatchPreset["patches"][0];

export default function PresetEditScreen({ route, navigation }: any) {
  const dialog = useDialog();
  const presetId: string | undefined = route.params?.presetId;
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [patches, setPatches] = useState<PatchLine[]>([]);
  const [allPresets, setAllPresets] = useState<PatchPreset[]>([]);

  useEffect(() => {
    (async () => {
      const list = await loadPresets();
      setAllPresets(list);
      if (presetId) {
        const p = list.find((x) => x.id === presetId);
        if (p) {
          setName(p.name);
          setDesc(p.description || "");
          setPatches([...p.patches]);
        }
      } else {
        setName("");
        setDesc("");
        setPatches([
          { search: "00 00 80 52", searchType: "hex", replace: "20 00 80 52", replaceType: "hex" },
        ]);
      }
    })();
  }, [presetId]);

  const addLine = () => {
    setPatches((prev) => [
      ...prev,
      { search: "", searchType: "string", replace: "", replaceType: "string" },
    ]);
  };

  const updateLine = (index: number, partial: Partial<PatchLine>) => {
    setPatches((prev) => prev.map((p, i) => (i === index ? { ...p, ...partial } : p)));
  };

  const removeLine = (index: number) => {
    setPatches((prev) => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (!name.trim()) {
      dialog.alert("Название обязательно");
      return;
    }
    const clean = patches.filter((p) => p.search.trim() && p.replace.trim());
    if (clean.length === 0) {
      dialog.alert("Добавь хотя бы одну замену");
      return;
    }

    let next: PatchPreset[];
    if (presetId) {
      next = allPresets.map((p) =>
        p.id === presetId
          ? { ...p, name: name.trim(), description: desc.trim(), patches: clean }
          : p
      );
    } else {
      next = [
        {
          id: Date.now().toString(36),
          name: name.trim(),
          description: desc.trim(),
          patches: clean,
          createdAt: Date.now(),
        },
        ...allPresets,
      ];
    }
    await savePresets(next);
    dialog.alert("Сохранено", "Пресет обновлён", [
      { text: "OK", onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={patches}
        keyExtractor={(_, i) => String(i)}
        ListHeaderComponent={
          <View style={{ marginBottom: 12 }}>
            <Text style={styles.label} selectable>Название</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholderTextColor={colors.textSecondary}
              placeholder="Unlock Pro"
            />
            <Text style={styles.label} selectable>Описание</Text>
            <TextInput
              style={styles.input}
              value={desc}
              onChangeText={setDesc}
              placeholderTextColor={colors.textSecondary}
              placeholder="Опционально"
            />
            <Text style={styles.section} selectable>Замены</Text>
          </View>
        }
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        renderItem={({ item, index }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.cardTitle} selectable>#{index + 1}</Text>
              <TouchableOpacity onPress={() => removeLine(index)}>
                <Text style={styles.del} selectable>Удалить</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.small} selectable>HEX</Text>
              <Switch
                value={item.searchType === "hex"}
                onValueChange={(v) =>
                  updateLine(index, {
                    searchType: v ? "hex" : "string",
                    replaceType: v ? "hex" : "string",
                  })
                }
                trackColor={{ true: colors.gold, false: colors.border }}
              />
            </View>

            <Text style={styles.small} selectable>Найти</Text>
            <TextInput
              style={styles.input}
              value={item.search}
              onChangeText={(t) => updateLine(index, { search: t })}
              placeholder={item.searchType === "hex" ? "00 00 80 52" : "isPro"}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
            />
            <Text style={styles.small} selectable>Заменить на</Text>
            <TextInput
              style={styles.input}
              value={item.replace}
              onChangeText={(t) => updateLine(index, { replace: t })}
              placeholder={item.searchType === "hex" ? "20 00 80 52" : "isPro"}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
            />
          </View>
        )}
        ListFooterComponent={
          <View style={{ gap: 12, marginTop: 8 }}>
            <TouchableOpacity style={styles.addLine} onPress={addLine}>
              <Text style={styles.addLineText} selectable>+ Добавить замену</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={save}>
              <Text style={styles.saveText} selectable>Сохранить пресет</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  label: { color: colors.gold, fontWeight: "700", marginBottom: 6 },
  section: { color: colors.gold, fontWeight: "700", fontSize: 16, marginTop: 8 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 12, color: colors.text,
    marginBottom: 10, borderWidth: 1, borderColor: colors.border,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  cardTitle: { color: colors.text, fontWeight: "700" },
  del: { color: colors.danger },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  small: { color: colors.textSecondary, fontSize: 12, marginBottom: 4 },
  addLine: {
    borderWidth: 1.5, borderColor: colors.gold, borderRadius: 12, padding: 14, alignItems: "center",
  },
  addLineText: { color: colors.gold, fontWeight: "700" },
  saveBtn: { backgroundColor: colors.gold, borderRadius: 12, padding: 16, alignItems: "center" },
  saveText: { color: colors.onGold, fontWeight: "800", fontSize: 16 },
});
