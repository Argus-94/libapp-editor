import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { colors } from "../theme";
import SelectableText from "./SelectableText";
import { SearchResult } from "../types";
import { isPremiumKey } from "../utils/unlock";
import { FEATURE_DEFS, CATEGORY_META, FeatureCategory } from "../utils/premiumFeatures";

interface Props {
  item: SearchResult;
  onToggle: () => void;
  onCustomReplace: () => void;
  onToggleNearby?: () => void;
  onBookmark?: () => void;
  onDisasm?: () => void;
  smartLabel?: string;
  onManual?: () => void;
  onCopyOffset?: () => void;
}

function matchFeature(value: string): { category: FeatureCategory; weight: number } | null {
  const v = value.trim();
  let best: { category: FeatureCategory; weight: number } | null = null;
  for (const d of FEATURE_DEFS) {
    if (v === d.key || v.includes(d.key)) {
      if (!best || d.weight > best.weight) best = { category: d.category, weight: d.weight };
    }
  }
  if (best) return best;
  if (isPremiumKey(v)) return { category: "pro_flag", weight: 60 };
  return null;
}

export default function ResultItem({
  item,
  onToggle,
  onCustomReplace,
  onToggleNearby,
  onBookmark,
  onDisasm,
  smartLabel,
  onManual,
  onCopyOffset,
}: Props) {
  const feat = item.type === "string" ? matchFeature(item.matchedValue) : null;
  const borderColor = feat
    ? feat.weight >= 90
      ? "#E74C3C"
      : feat.weight >= 75
      ? "#E67E22"
      : CATEGORY_META[feat.category]?.color || colors.border
    : colors.border;

  return (
    <View style={[styles.card, { borderLeftWidth: feat ? 4 : 1, borderLeftColor: borderColor }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onDisasm} disabled={!onDisasm}>
          <SelectableText style={styles.offset} copyValue={item.hexOffset}>
            {item.hexOffset} {onDisasm ? "▸" : ""}
          </SelectableText>
        </TouchableOpacity>
        <View style={styles.badges}>
          {feat && (
            <View style={[styles.badge, { backgroundColor: CATEGORY_META[feat.category]?.color || colors.gold }]}>
              <Text style={styles.badgeTextDark}>{CATEGORY_META[feat.category]?.short || "PRO"}</Text>
            </View>
          )}
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{item.type.toUpperCase()}</Text>
          </View>
        </View>
      </View>

      <SelectableText
        style={[styles.value, feat && feat.weight >= 85 && styles.valueHot]}
        numberOfLines={2}
        copyValue={item.matchedValue}
      >
        {item.matchedValue}
      </SelectableText>

      <SelectableText style={styles.context} numberOfLines={2} copyValue={item.contextHex}>
        {item.contextHex}
      </SelectableText>

      {item.nearbyBool && (
        <View style={styles.nearby}>
          <Text style={styles.nearbyLabel}>
            Рядом bool: {item.nearbyBool.isTrue ? "TRUE" : "FALSE"} @{" "}
            {"0x" + item.nearbyBool.offset.toString(16).toUpperCase()}
          </Text>
          {onToggleNearby && (
            <TouchableOpacity style={styles.nearbyBtn} onPress={onToggleNearby}>
              <Text style={styles.nearbyBtnText}>Переключить bool</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {feat && feat.weight >= 75 && !item.nearbyBool && (
        <Text style={styles.warn}>
          Сильный PRO-маркер, но bool рядом может не быть — лучше Manual / Analyze
        </Text>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.btnGold} onPress={onToggle} activeOpacity={0.8}>
          <Text style={styles.btnText}>{smartLabel || "Вкл / Выкл"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btnOutline} onPress={onCustomReplace} activeOpacity={0.8}>
          <Text style={styles.btnOutlineText}>Заменить</Text>
        </TouchableOpacity>

        {onManual && (
          <TouchableOpacity style={styles.btnIcon} onPress={onManual}>
            <Text style={styles.btnIconText}>M</Text>
          </TouchableOpacity>
        )}
        {onCopyOffset && (
          <TouchableOpacity style={styles.btnIcon} onPress={onCopyOffset}>
            <Text style={styles.btnIconText}>⧉</Text>
          </TouchableOpacity>
        )}
        {onBookmark && (
          <TouchableOpacity style={styles.btnIcon} onPress={onBookmark}>
            <Text style={styles.btnIconText}>★</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  offset: { color: colors.gold, fontFamily: "monospace", fontWeight: "700", fontSize: 13 },
  badges: { flexDirection: "row", gap: 6 },
  badge: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeText: { color: colors.textSecondary, fontSize: 10, fontWeight: "800" },
  badgeTextDark: { color: colors.onGold, fontSize: 10, fontWeight: "900" },
  value: { color: colors.text, fontWeight: "600", marginTop: 8, fontSize: 15 },
  valueHot: { color: "#E74C3C" },
  context: { color: colors.textSecondary, fontFamily: "monospace", fontSize: 11, marginTop: 6 },
  nearby: {
    marginTop: 8,
    padding: 8,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
  },
  nearbyLabel: { color: colors.textSecondary, fontSize: 12 },
  nearbyBtn: { marginTop: 6 },
  nearbyBtnText: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  warn: { color: "#E67E22", fontSize: 11, marginTop: 8, lineHeight: 15 },
  actions: { flexDirection: "row", marginTop: 12, gap: 8, alignItems: "center" },
  btnGold: {
    flex: 1,
    backgroundColor: colors.gold,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  btnText: { color: colors.onGold, fontWeight: "800", fontSize: 13 },
  btnOutline: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  btnOutlineText: { color: colors.gold, fontWeight: "700", fontSize: 13 },
  btnIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  btnIconText: { color: colors.gold, fontWeight: "800", fontSize: 14 },
});
