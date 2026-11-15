import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors } from "../theme";
import { APP_BUILD_LABEL } from "../version";

export default function DeveloperFooter() {
  return (
    <View style={styles.footer}>
      <Text style={styles.line}>{APP_BUILD_LABEL} · Made in Ukraine</Text>
      <Text style={styles.dev}>Developer 彡ҜÃƦÃT彡ᡕᠵデ气亠</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    marginTop: 28,
    paddingVertical: 16,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  line: { color: colors.textSecondary, fontSize: 12 },
  dev: { color: colors.gold, fontSize: 13, marginTop: 4, fontWeight: "600" },
});
