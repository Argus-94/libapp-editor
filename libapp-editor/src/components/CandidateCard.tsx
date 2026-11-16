import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { colors } from "../theme";
import { CodeCandidate } from "../utils/onDeviceRe";
import { copyText } from "../utils/copyText";

type Props = {
  item: CodeCandidate;
  onDisasm?: () => void;
  onManual?: () => void;
  onTrue?: () => void;
  onEnqueue?: () => void;
};

export default function CandidateCard({ item, onDisasm, onManual, onTrue, onEnqueue }: Props) {
  return (
    <View style={[styles.card, item.score >= 55 && styles.cardHot]}>
      <Text style={styles.off} selectable>
        {item.hexOffset}
      </Text>
      <Text style={styles.meta} selectable>
        score {item.score} · {item.kind}
        {item.stringKey ? ` · ${item.stringKey}` : ""}
      </Text>
      <Text style={styles.hex} selectable>
        {item.movzHex}
        {item.patchHex ? `  →  ${item.patchHex}` : ""}
      </Text>
      <Text style={styles.reason} selectable numberOfLines={3}>
        {item.reason}
      </Text>
      <View style={styles.row}>
        {onDisasm && (
          <TouchableOpacity style={styles.btn} onPress={onDisasm}>
            <Text style={styles.btnText} selectable>
              Disasm
            </Text>
          </TouchableOpacity>
        )}
        {onManual && (
          <TouchableOpacity style={[styles.btn, styles.btnMain]} onPress={onManual}>
            <Text style={styles.btnMainText} selectable>
              Manual
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.btn} onPress={() => copyText("offset", item.hexOffset)}>
          <Text style={styles.btnText} selectable>
            Copy
          </Text>
        </TouchableOpacity>
        {onTrue && item.patchHex && (
          <TouchableOpacity style={styles.btn} onPress={onTrue}>
            <Text style={[styles.btnText, { color: colors.success }]} selectable>
              True
            </Text>
          </TouchableOpacity>
        )}
        {onEnqueue && item.patchHex && (
          <TouchableOpacity style={styles.btn} onPress={onEnqueue}>
            <Text style={styles.btnText} selectable>
              +
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHot: { borderColor: colors.borderGold },
  off: { color: colors.goldLight, fontFamily: "monospace", fontWeight: "800", fontSize: 14 },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  hex: { color: colors.text, fontFamily: "monospace", fontSize: 12, marginTop: 6 },
  reason: { color: colors.textSecondary, fontSize: 11, marginTop: 6, lineHeight: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  btn: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderGold,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  btnMain: { backgroundColor: colors.gold, borderColor: colors.gold },
  btnText: { color: colors.gold, fontWeight: "800", fontSize: 13 },
  btnMainText: { color: colors.onGold, fontWeight: "800", fontSize: 13 },
});
