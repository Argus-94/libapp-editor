import { StyleSheet, TextStyle, ViewStyle } from "react-native";
import { colors } from "./theme";

/** Common layout tokens — use across screens for consistent look */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };

export const ui = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenPad: {
    padding: 16,
    paddingBottom: 48,
  },
  title: {
    color: colors.goldLight,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 12,
  },
  section: {
    color: colors.gold,
    fontWeight: "800",
    fontSize: 15,
    marginBottom: 10,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardGold: {
    borderColor: colors.borderGold,
  },
  note: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 12,
  },
  muted: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  mono: {
    color: colors.text,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 18,
  },
  monoGold: {
    color: colors.goldLight,
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "700",
  },
  btnPrimary: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    minHeight: 48,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimaryText: {
    color: colors.onGold,
    fontWeight: "800",
    fontSize: 15,
  },
  btnSecondary: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderGold,
  },
  btnSecondaryText: {
    color: colors.gold,
    fontWeight: "700",
    fontSize: 13,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 15,
  },
  warnBox: {
    backgroundColor: colors.warningSurface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  warnTitle: {
    color: colors.warning,
    fontWeight: "800",
    marginBottom: 4,
  },
  warnBody: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
});
