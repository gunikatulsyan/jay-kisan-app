import { ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, IconName } from "@/src/components/Icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type V = "display" | "hero" | "title" | "subtitle" | "body" | "bodyMedium" | "caption" | "label";
const VARIANTS: Record<V, TextStyle> = {
  hero: { fontFamily: fonts.medium, fontSize: 48, lineHeight: 56 },
  display: { fontFamily: fonts.medium, fontSize: 24, lineHeight: 30 },
  title: { fontFamily: fonts.medium, fontSize: 20, lineHeight: 26 },
  subtitle: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, letterSpacing: 0.4, textTransform: "uppercase" },
};

export function Txt({ v = "body", color, style, children, numberOfLines, testID, selectable }: {
  v?: V; color?: string; style?: StyleProp<TextStyle>; children: ReactNode; numberOfLines?: number; testID?: string; selectable?: boolean;
}) {
  const { colors } = useTheme();
  const c = color ?? (v === "caption" || v === "label" ? colors.muted : colors.onSurface);
  return (
    <Text testID={testID} numberOfLines={numberOfLines} selectable={selectable} style={[VARIANTS[v], { color: c }, style]}>
      {children}
    </Text>
  );
}

type BtnVariant = "primary" | "secondary" | "danger" | "ghost" | "outline";
export function Button({ title, onPress, variant = "primary", icon, loading, disabled, size = "md", testID, style }: {
  title: string; onPress?: () => void; variant?: BtnVariant; icon?: IconName; loading?: boolean; disabled?: boolean;
  size?: "sm" | "md" | "lg" | "xl"; testID?: string; style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const bg = { primary: colors.brandPrimary, secondary: colors.brandSecondary, danger: colors.error, ghost: "transparent", outline: colors.surfaceSecondary }[variant];
  const fg = { primary: colors.onBrandPrimary, secondary: colors.onBrandSecondary, danger: colors.onError, ghost: colors.brandPrimary, outline: colors.onSurface }[variant];
  const h = { sm: 36, md: 48, lg: 56, xl: 64 }[size];
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        {
          height: h, borderRadius: radius.md, backgroundColor: bg, flexDirection: "row", alignItems: "center", justifyContent: "center",
          paddingHorizontal: size === "sm" ? spacing.md : spacing.lg, gap: spacing.sm, opacity: off ? 0.5 : pressed ? 0.85 : 1,
          borderWidth: variant === "outline" ? 1 : 0, borderColor: colors.borderStrong, transform: [{ scale: pressed && !off ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={size === "sm" ? 16 : 20} color={fg} /> : null}
      <Text style={{ fontFamily: fonts.medium, fontSize: size === "sm" ? 13 : size === "xl" ? 18 : 15, color: fg }} numberOfLines={1}>{title}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, testID, badge, color, size = 22, label }: {
  icon: IconName; onPress?: () => void; testID?: string; badge?: number; color?: string; size?: number; label?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} accessibilityLabel={label} onPress={onPress} hitSlop={8}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: pressed ? colors.surfaceTertiary : "transparent" })}>
      <Icon name={icon} size={size} color={color ?? colors.onSurface} />
      {badge ? (
        <View style={{ position: "absolute", top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
          <Text style={{ color: colors.onError, fontFamily: fonts.medium, fontSize: 10 }}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function Field({ label, error, hint, right, style, inputStyle, ...props }: TextInputProps & {
  label?: string; error?: string | null; hint?: string; right?: ReactNode; inputStyle?: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View style={[{ gap: spacing.xs }, style as any]}>
      {label ? <Txt v="bodyMedium" color={colors.onSurfaceSecondary}>{label}</Txt> : null}
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: error ? colors.error : colors.border, borderRadius: radius.md, minHeight: 48 }}>
        <TextInput
          placeholderTextColor={colors.muted}
          {...props}
          style={[{ flex: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.md, fontFamily: fonts.regular, fontSize: 15, color: colors.onSurface, outlineStyle: "none" } as any, inputStyle]}
        />
        {right}
      </View>
      {error ? <Txt v="caption" color={colors.error}>{error}</Txt> : hint ? <Txt v="caption">{hint}</Txt> : null}
    </View>
  );
}

export function Card({ children, style, onPress, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; testID?: string }) {
  const styles = useStyles();
  if (onPress) {
    return (
      <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.9 : 1 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View testID={testID} style={[styles.card, style]}>{children}</View>;
}

type Tone = "neutral" | "success" | "warning" | "error" | "brand" | "inverse";
export function Badge({ label, tone = "neutral", testID }: { label: string; tone?: Tone; testID?: string }) {
  const { colors } = useTheme();
  const map = {
    neutral: [colors.surfaceTertiary, colors.onSurfaceTertiary],
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    error: [colors.errorSoft, colors.error],
    brand: [colors.brandSecondary, colors.onBrandSecondary],
    inverse: [colors.surfaceInverse, colors.onSurfaceInverse],
  }[tone];
  return (
    <View testID={testID} style={{ backgroundColor: map[0], borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2, alignSelf: "flex-start" }}>
      <Text style={{ color: map[1], fontFamily: fonts.medium, fontSize: 11, letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

export function StatusBadge({ status, testID }: { status?: string | null; testID?: string }) {
  if (status === "out") return <Badge label="OUT OF STOCK" tone="error" testID={testID} />;
  if (status === "low") return <Badge label="LOW STOCK" tone="warning" testID={testID} />;
  return <Badge label="IN STOCK" tone="success" testID={testID} />;
}

export function Chip({ label, selected, onPress, testID, icon }: { label: string; selected?: boolean; onPress?: () => void; testID?: string; icon?: IconName }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress}
      style={{ height: 36, flexShrink: 0, borderRadius: radius.pill, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: 6,
        backgroundColor: selected ? colors.brandPrimary : colors.surfaceSecondary, borderWidth: 1, borderColor: selected ? colors.brandPrimary : colors.border }}>
      {icon ? <Icon name={icon} size={14} color={selected ? colors.onBrandPrimary : colors.onSurfaceSecondary} /> : null}
      <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: selected ? colors.onBrandPrimary : colors.onSurfaceSecondary }}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <ScrollView testID={testID} horizontal showsHorizontalScrollIndicator={false} style={{ height: 56, flexGrow: 0 }}
      contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg, alignItems: "center" }}>
      {children}
    </ScrollView>
  );
}

export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ padding: spacing.xxl, alignItems: "center", gap: spacing.md }} testID="loading-indicator">
      <ActivityIndicator color={colors.brandPrimary} />
      {label ? <Txt v="caption">{label}</Txt> : null}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ padding: spacing.xl, alignItems: "center", gap: spacing.md }} testID="error-view">
      <Icon name="cloud-offline-outline" size={36} color={colors.error} />
      <Txt v="bodyMedium" style={{ textAlign: "center" }}>{message}</Txt>
      {onRetry ? <Button title="Retry" variant="outline" size="sm" onPress={onRetry} testID="retry-button" /> : null}
    </View>
  );
}

export function Empty({ icon = "file-tray-outline", title, message, action }: { icon?: IconName; title: string; message?: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ padding: spacing.xxl, alignItems: "center", gap: spacing.sm }} testID="empty-state">
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={28} color={colors.brandPrimary} />
      </View>
      <Txt v="subtitle" style={{ textAlign: "center" }}>{title}</Txt>
      {message ? <Txt v="body" color={colors.muted} style={{ textAlign: "center" }}>{message}</Txt> : null}
      {action}
    </View>
  );
}

export function KV({ label, value, testID, strong }: { label: string; value: ReactNode; testID?: string; strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm, gap: spacing.lg }}>
      <Txt v="body" color={colors.muted}>{label}</Txt>
      {typeof value === "string" || typeof value === "number" ? (
        <Txt v={strong ? "subtitle" : "bodyMedium"} testID={testID} style={{ flexShrink: 1, textAlign: "right" }} selectable>{value}</Txt>
      ) : value}
    </View>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm }}>
      <Txt v="subtitle">{title}</Txt>
      {action}
    </View>
  );
}

export function Banner({ tone = "warning", text, testID }: { tone?: "warning" | "error" | "success" | "neutral"; text: string; testID?: string }) {
  const { colors } = useTheme();
  const bg = { warning: colors.warningSoft, error: colors.errorSoft, success: colors.successSoft, neutral: colors.surfaceTertiary }[tone];
  const fg = { warning: colors.warning, error: colors.error, success: colors.success, neutral: colors.onSurfaceTertiary }[tone];
  const icon: IconName = tone === "success" ? "checkmark-circle" : tone === "neutral" ? "information-circle" : "alert-circle";
  return (
    <View testID={testID} style={{ flexDirection: "row", gap: spacing.sm, backgroundColor: bg, borderRadius: radius.md, padding: spacing.md, alignItems: "flex-start" }}>
      <Icon name={icon} size={18} color={fg} />
      <Txt v="bodyMedium" color={fg} style={{ flex: 1 }}>{text}</Txt>
    </View>
  );
}

export function Sheet({ visible, onClose, title, children, testID, scroll = true, footer }: {
  visible: boolean; onClose: () => void; title?: string; children: ReactNode; testID?: string; scroll?: boolean; footer?: ReactNode;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}>
        <Pressable style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.backdrop }} onPress={onClose} testID={testID ? `${testID}-backdrop` : undefined} />
        <View testID={testID} style={{ width: "100%", maxWidth: 640, maxHeight: "90%", backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: insets.bottom + spacing.lg }}>
          <View style={{ alignItems: "center", paddingTop: spacing.sm }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong }} />
          </View>
          {title ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
              <Txt v="title" style={{ flex: 1 }}>{title}</Txt>
              <IconButton icon="close" onPress={onClose} testID={testID ? `${testID}-close` : "sheet-close"} label="Close" />
            </View>
          ) : null}
          {scroll ? (
            <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              {children}
            </KeyboardAwareScrollView>
          ) : (
            <View style={{ padding: spacing.lg, gap: spacing.md, flexShrink: 1 }}>{children}</View>
          )}
          {footer ? <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

export function Checkbox({ checked, onToggle, label, testID }: { checked: boolean; onToggle: () => void; label: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable testID={testID} onPress={onToggle} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 }}>
      <View style={{ width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1.5, borderColor: checked ? colors.brandPrimary : colors.borderStrong, backgroundColor: checked ? colors.brandPrimary : colors.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
        {checked ? <Icon name="checkmark" size={16} color={colors.onBrandPrimary} /> : null}
      </View>
      <Txt v="bodyMedium" style={{ flex: 1 }}>{label}</Txt>
    </Pressable>
  );
}

export function StatCard({ label, value, sub, icon, tone, testID, onPress }: {
  label: string; value: string; sub?: string; icon: IconName; tone?: "brand" | "warning" | "error" | "neutral"; testID?: string; onPress?: () => void;
}) {
  const { colors } = useTheme();
  const accent = { brand: colors.brandPrimary, warning: colors.warning, error: colors.error, neutral: colors.onSurfaceTertiary }[tone ?? "neutral"];
  return (
    <Card testID={testID} onPress={onPress} style={{ flexGrow: 1, flexBasis: 150, minWidth: 150, gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Icon name={icon} size={16} color={accent} />
        <Txt v="caption" numberOfLines={1} style={{ flex: 1 }}>{label}</Txt>
      </View>
      <Txt v="title" numberOfLines={1} testID={testID ? `${testID}-value` : undefined}>{value}</Txt>
      {sub ? <Txt v="caption" numberOfLines={2}>{sub}</Txt> : null}
    </Card>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.lg },
}));
