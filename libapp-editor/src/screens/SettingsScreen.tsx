import { useDialog } from "../components/DialogProvider";
import { navigateRoot } from "../utils/nav";
import React, { useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, Switch, ScrollView,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { colors, Accent } from "../theme";
import { APP_VERSION } from "../version";
import { AppSettings } from "../types";
import { loadSettings, saveSettings } from "../store/storage";
import DeveloperFooter from "../components/DeveloperFooter";

const ACCENTS: { key: Accent; label: string; color: string }[] = [
  { key: "gold", label: "Золото", color: "#C9A227" },
  { key: "emerald", label: "Изумруд", color: "#2ECC71" },
  { key: "blue", label: "Синий", color: "#3498DB" },
  { key: "purple", label: "Фиолет", color: "#9B59B6" },
];

type Ion = React.ComponentProps<typeof Ionicons>["name"];

function ToolRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: Ion;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.tool} onPress={onPress} activeOpacity={0.75}>
      <Ionicons name={icon} size={22} color={colors.gold} style={styles.toolIcon} />
      <View style={styles.toolBody}>
        <Text style={styles.toolTitle} selectable>{title}</Text>
        <Text style={styles.toolSub} selectable>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

export default function SettingsScreen({ navigation }: any) {
  const dialog = useDialog();
  const [settings, setSettings] = useState<AppSettings>({
    accent: "gold",
    autoBackup: true,
    maxHistory: 200,
  });

  useFocusEffect(
    useCallback(() => {
      loadSettings().then(setSettings);
    }, [])
  );

  const update = async (partial: Partial<AppSettings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    await saveSettings(next);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.hero} selectable>Порядок: Файл → Анализ → Патч → APK</Text>
      <Text style={styles.heroSub} selectable>
        Основные шаги — в нижнем меню. Здесь доп. инструменты.
      </Text>

      <Text style={styles.section} selectable>С чего начать</Text>
      <ToolRow
        icon="map-outline"
        title="Мастер патча"
        subtitle="Файл → анализ → один кандидат → патч"
        onPress={() => navigateRoot(navigation, "Wizard")}
      />
      <ToolRow
        icon="layers-outline"
        title="Очередь патчей"
        subtitle="Несколько offset → применить разом"
        onPress={() => navigateRoot(navigation, "Queue")}
      />

      <Text style={styles.section} selectable>После анализа</Text>
      <ToolRow
        icon="diamond-outline"
        title="PRO-скан"
        subtitle="Подсветка платных маркеров в so"
        onPress={() => navigateRoot(navigation, "PremiumScan")}
      />
      <ToolRow
        icon="flash-outline"
        title="Auto Unlock"
        subtitle="Только safe, мало патчей, с бэкапом"
        onPress={() => navigateRoot(navigation, "AutoUnlock")}
      />
      <ToolRow
        icon="download-outline"
        title="Import dump"
        subtitle="Offsets из Blutter/r2 с ПК"
        onPress={() => navigateRoot(navigation, "ImportDump")}
      />

      <Text style={styles.section} selectable>Файл и история</Text>
      <ToolRow
        icon="git-compare-outline"
        title="Сравнение .so"
        subtitle="Текущий vs backup"
        onPress={() => navigateRoot(navigation, "Compare")}
      />
      <ToolRow
        icon="bookmark-outline"
        title="Закладки"
        subtitle="Сохранённые offsets"
        onPress={() => navigateRoot(navigation, "Bookmarks")}
      />
      <ToolRow
        icon="time-outline"
        title="История патчей"
        subtitle="Что уже меняли"
        onPress={() => navigateRoot(navigation, "History")}
      />
      <ToolRow
        icon="list-outline"
        title="Пресеты"
        subtitle="Готовые search/replace"
        onPress={() => navigateRoot(navigation, "Presets")}
      />

      <Text style={styles.section} selectable>Справка и отладка</Text>
      <ToolRow
        icon="book-outline"
        title="Инструкция"
        subtitle="Пошагово для начинающих"
        onPress={() => navigateRoot(navigation, "Help")}
      />
      <ToolRow
        icon="terminal-outline"
        title="Logcat"
        subtitle="Внутренний лог редактора"
        onPress={() => navigateRoot(navigation, "Logcat")}
      />

      <Text style={styles.section} selectable>Настройки</Text>
      <Text style={styles.label} selectable>Акцент</Text>
      <View style={styles.row}>
        {ACCENTS.map((a) => (
          <TouchableOpacity
            key={a.key}
            style={[
              styles.swatch,
              { backgroundColor: a.color },
              settings.accent === a.key && styles.swatchActive,
            ]}
            onPress={() => update({ accent: a.key })}
          >
            {settings.accent === a.key && <Text style={styles.check} selectable>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint} selectable>Акцент — после перезапуска</Text>

      <View style={styles.item}>
        <View style={{ flex: 1 }}>
          <Text style={styles.itemTitle} selectable>Автобэкап</Text>
          <Text style={styles.itemDesc} selectable>Копия so при открытии</Text>
        </View>
        <Switch
          value={settings.autoBackup}
          onValueChange={(v) => update({ autoBackup: v })}
          trackColor={{ true: colors.gold, false: colors.border }}
          thumbColor="#fff"
        />
      </View>

      <Text style={styles.label} selectable>Лимит истории</Text>
      <View style={styles.histRow}>
        {[50, 100, 200, 500].map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.histChip, settings.maxHistory === n && styles.histChipOn]}
            onPress={() => update({ maxHistory: n })}
          >
            <Text
              style={[styles.histChipText, settings.maxHistory === n && styles.histChipTextOn]}
              selectable
            >
              {n}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint} selectable>Сколько записей патчей хранить (старые отбрасываются)</Text>

      <TouchableOpacity
        style={styles.about}
        onPress={() =>
          dialog.alert(
            "LibApp Editor",
            `v${APP_VERSION}\n\nМастер или:\n1 Файл → so\n2 Анализ → candidates\n3 Патч / Очередь\n4 Compare\n5 APK inject + resign\n\nisPro-строка ≠ код. Патч только .text`
          )
        }
      >
        <Text style={styles.aboutText} selectable>О приложении · v{APP_VERSION}</Text>
      </TouchableOpacity>
      <DeveloperFooter />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, paddingBottom: 40 },
  hero: { color: colors.gold, fontWeight: "800", fontSize: 16, marginBottom: 4 },
  heroSub: { color: colors.textSecondary, fontSize: 13, marginBottom: 20, lineHeight: 18 },
  section: {
    color: colors.textSecondary,
    fontWeight: "700",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 18,
    marginBottom: 10,
  },
  tool: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolIcon: { marginRight: 12 },
  toolBody: { flex: 1 },
  toolTitle: { color: colors.text, fontWeight: "700", fontSize: 15 },
  toolSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  label: { color: colors.text, fontWeight: "600", marginBottom: 10 },
  row: { flexDirection: "row", gap: 14, marginBottom: 8 },
  swatch: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center",
  },
  swatchActive: { borderWidth: 3, borderColor: "#fff" },
  check: { color: colors.onGold, fontWeight: "900", fontSize: 18 },
  hint: { color: colors.textSecondary, fontSize: 12, marginBottom: 16 },
  item: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    backgroundColor: colors.surface, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: colors.border, marginBottom: 12,
  },
  itemTitle: { color: colors.text, fontWeight: "600", fontSize: 16 },
  itemDesc: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  histRow: { flexDirection: "row", gap: 10, marginBottom: 8 },
  histChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  histChipOn: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  histChipText: { color: colors.textSecondary, fontWeight: "700", fontSize: 14 },
  histChipTextOn: { color: colors.gold },
  about: { marginTop: 24, alignItems: "center" },
  aboutText: { color: colors.gold, fontWeight: "600" },
});
