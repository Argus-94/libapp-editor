import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";
import { colors } from "../theme";
import SelectableText from "./SelectableText";

export interface ModalAction {
  label: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "danger" | "ghost";
}

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  children?: React.ReactNode;
  actions?: ModalAction[];
  onClose?: () => void;
}

export default function AppModal({
  visible,
  title,
  message,
  children,
  actions,
  onClose,
}: Props) {
  const list =
    actions && actions.length > 0
      ? actions
      : onClose
      ? [{ label: "OK", onPress: onClose, variant: "primary" as const }]
      : [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.box} onPress={(e) => e.stopPropagation()}>
          <View style={styles.accentBar} />
          <SelectableText style={styles.title} copyValue={title}>{title}</SelectableText>
          {!!message && (
            <ScrollView style={styles.msgScroll} nestedScrollEnabled>
              <SelectableText style={styles.message} copyValue={message}>{message}</SelectableText>
            </ScrollView>
          )}
          {children ? <View style={{ marginBottom: 8, maxHeight: 420 }}>{children}</View> : null}
          {list.length > 0 && (
            <View style={styles.actions}>
              {list.map((a) => {
                const v = a.variant || "primary";
                return (
                  <TouchableOpacity
                    key={a.label}
                    style={[
                      styles.btn,
                      v === "primary" && styles.btnPrimary,
                      v === "outline" && styles.btnOutline,
                      v === "danger" && styles.btnDanger,
                      v === "ghost" && styles.btnGhost,
                    ]}
                    onPress={a.onPress}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        styles.btnText,
                        v === "primary" && styles.btnTextPrimary,
                        v === "outline" && styles.btnTextGold,
                        v === "danger" && styles.btnTextDanger,
                        v === "ghost" && styles.btnTextMuted,
                      ]}
                    >
                      {a.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: "center",
    padding: 24,
  },
  box: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: 16,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: colors.borderGold,
    maxHeight: "88%",
    overflow: "hidden",
  },
  accentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.gold,
  },
  title: {
    color: colors.goldLight,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  msgScroll: { maxHeight: 420, marginBottom: 8 },
  message: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 8,
  },
  actions: { gap: 8, marginTop: 12 },
  btn: {
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  btnPrimary: {
    backgroundColor: colors.gold,
  },
  btnOutline: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: colors.gold,
  },
  btnDanger: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: colors.danger,
  },
  btnGhost: {
    backgroundColor: "transparent",
  },
  btnText: { fontWeight: "800", fontSize: 15 },
  btnTextPrimary: { color: colors.onGold },
  btnTextGold: { color: colors.gold },
  btnTextDanger: { color: colors.danger },
  btnTextMuted: { color: colors.textSecondary, fontWeight: "600" },
});
