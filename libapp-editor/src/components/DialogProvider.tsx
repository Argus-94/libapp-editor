import React, { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";
import AppModal, { ModalAction } from "./AppModal";

type DialogOpts = {
  title: string;
  message?: string;
  actions?: ModalAction[];
};

type DialogApi = {
  alert: (title: string, message?: string, actions?: ModalAction[]) => void;
  confirm: (
    title: string,
    message: string,
    onYes: () => void,
    yesLabel?: string,
    destructive?: boolean
  ) => void;
  close: () => void;
};

const Ctx = createContext<DialogApi | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dlg, setDlg] = useState<DialogOpts | null>(null);

  const close = useCallback(() => setDlg(null), []);

  const alert = useCallback((title: string, message?: string, actions?: any) => {
    let acts: ModalAction[] | undefined;
    if (Array.isArray(actions) && actions.length && actions[0]?.text) {
      // React Native Alert-style buttons
      acts = actions.map((b: any) => ({
        label: String(b.text || "OK"),
        variant:
          b.style === "destructive" ? "danger" : b.style === "cancel" ? "ghost" : "primary",
        onPress: () => {
          try {
            b.onPress?.();
          } catch {
            /* */
          }
        },
      }));
    } else if (Array.isArray(actions)) {
      acts = actions as ModalAction[];
    }
    setDlg({
      title,
      message,
      actions: acts?.length ? acts : [{ label: "OK", onPress: () => setDlg(null) }],
    });
  }, []);

  const confirm = useCallback(
    (
      title: string,
      message: string,
      onYes: () => void,
      yesLabel = "OK",
      destructive = false
    ) => {
      setDlg({
        title,
        message,
        actions: [
          {
            label: "Отмена",
            variant: "ghost",
            onPress: () => setDlg(null),
          },
          {
            label: yesLabel,
            variant: destructive ? "danger" : "primary",
            onPress: () => {
              setDlg(null);
              onYes();
            },
          },
        ],
      });
    },
    []
  );

  const api = useMemo(() => ({ alert, confirm, close }), [alert, confirm, close]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <AppModal
        visible={!!dlg}
        title={dlg?.title || ""}
        message={dlg?.message}
        onClose={close}
        actions={
          dlg?.actions?.map((a) => ({
            ...a,
            onPress: () => {
              const fn = a.onPress;
              setDlg(null);
              // run after close tick
              requestAnimationFrame(() => fn());
            },
          })) || [{ label: "OK", onPress: close }]
        }
      />
    </Ctx.Provider>
  );
}

export function useDialog(): DialogApi {
  const v = useContext(Ctx);
  if (!v) {
    // fallback no-op safe
    return {
      alert: (title, message) => {
        try {
          // eslint-disable-next-line no-console
          console.warn("[dialog]", title, message);
        } catch {
          /* */
        }
      },
      confirm: (_t, _m, onYes) => onYes(),
      close: () => {},
    };
  }
  return v;
}
