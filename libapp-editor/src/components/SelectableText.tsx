import React from "react";
import { Text, TextProps, StyleProp, TextStyle } from "react-native";
import { colors } from "../theme";
import { copyText } from "../utils/copyText";

/**
 * Selectable text + long-press → share/copy sheet.
 * Use for offsets, hex, reports, disasm — everywhere user may need to copy.
 */
export default function SelectableText({
  children,
  style,
  copyValue,
  ...rest
}: TextProps & {
  style?: StyleProp<TextStyle>;
  /** Explicit string to copy on long-press (defaults to string children) */
  copyValue?: string;
}) {
  const str =
    copyValue ??
    (typeof children === "string" || typeof children === "number"
      ? String(children)
      : undefined);

  return (
    <Text
      {...rest}
      selectable
      style={style}
      onLongPress={
        str
          ? () => {
              copyText("copy", str);
            }
          : rest.onLongPress
      }
    >
      {children}
    </Text>
  );
}

export function MonoText(props: React.ComponentProps<typeof SelectableText>) {
  return (
    <SelectableText
      {...props}
      style={[
        {
          fontFamily: "monospace",
          color: colors.text,
          fontSize: 13,
        },
        props.style as any,
      ]}
    />
  );
}
