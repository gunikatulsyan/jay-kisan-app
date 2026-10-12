import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/src/components/Icon";
import { fonts, radius, spacing, useTheme } from "@/src/theme";

type ToastInput = { title: string; message?: string; tone?: "success" | "error" | "info"; actionLabel?: string; onAction?: () => void };
const ToastCtx = createContext<{ show: (t: ToastInput) => void }>({ show: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastInput | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setToast(null));
  }, [anim]);

  const show = useCallback((t: ToastInput) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(t);
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    timer.current = setTimeout(hide, t.onAction ? 6000 : 3500);
  }, [anim, hide]);

  const tone = toast?.tone ?? "info";
  const accent = tone === "success" ? colors.success : tone === "error" ? colors.error : colors.brandSecondary;
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="box-none" style={{ position: "absolute", top: insets.top + spacing.sm, left: 0, right: 0, alignItems: "center", paddingHorizontal: spacing.lg,
          opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }}>
          <Pressable testID="toast" onPress={hide} style={{ width: "100%", maxWidth: 520, backgroundColor: colors.surfaceInverse, borderRadius: radius.md, padding: spacing.md, flexDirection: "row", gap: spacing.md, alignItems: "center",
            shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
            <Icon name={tone === "success" ? "checkmark-circle" : tone === "error" ? "alert-circle" : "notifications"} size={22} color={accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.onSurfaceInverse, fontFamily: fonts.medium, fontSize: 14 }} testID="toast-title">{toast.title}</Text>
              {toast.message ? <Text style={{ color: colors.onSurfaceInverse, fontFamily: fonts.regular, fontSize: 13, opacity: 0.85 }} numberOfLines={3}>{toast.message}</Text> : null}
            </View>
            {toast.onAction ? (
              <Pressable testID="toast-action" onPress={() => { toast.onAction?.(); hide(); }} hitSlop={8} style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.xs }}>
                <Text style={{ color: colors.brandSecondary, fontFamily: fonts.medium, fontSize: 14 }}>{toast.actionLabel ?? "View"}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}
