import { router } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/src/auth/AuthContext";
import { AppHeader } from "@/src/components/AppHeader";
import { Icon, IconName } from "@/src/components/Icon";
import { OWNER_NAV } from "@/src/components/OwnerShell";
import { Card, Txt } from "@/src/components/ui";
import { usesNativeTabs } from "@/src/navigation";
import { radius, spacing, useTheme } from "@/src/theme";

const HIDE = ["/dashboard", "/inventory", "/alerts"];

function Item({ icon, label, onPress, testID, danger }: { icon: IconName; label: string; onPress: () => void; testID: string; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: pressed ? colors.surfaceTertiary : "transparent" })}>
      <Icon name={icon} color={danger ? colors.error : colors.onSurfaceSecondary} />
      <Txt v="bodyMedium" color={danger ? colors.error : colors.onSurface} style={{ flex: 1 }}>{label}</Txt>
      <Icon name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}

export default function More() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { me, logout } = useAuth();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="More" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: (usesNativeTabs ? insets.bottom : 0) + spacing.lg }}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
            <Txt v="subtitle" color={colors.onBrand}>{me?.user.full_name.slice(0, 1)}</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt v="subtitle">{me?.user.full_name}</Txt>
            <Txt v="caption">Owner · @{me?.user.username}</Txt>
          </View>
        </Card>
        <Card style={{ padding: spacing.sm }}>
          {OWNER_NAV.filter((n) => !HIDE.includes(n.href)).map((n) => (
            <Item key={n.href} icon={n.icon} label={n.label} onPress={() => router.push(n.href as any)} testID={`more-${n.href.slice(1)}`} />
          ))}
        </Card>
        <Card style={{ padding: spacing.sm }}>
          <Item icon="key-outline" label="Change password" onPress={() => router.push("/change-password")} testID="more-change-password" />
          <Item icon="phone-portrait-outline" label="Sign out of all devices" onPress={() => logout(true)} testID="more-logout-all" />
          <Item icon="log-out-outline" label="Sign out" onPress={() => logout()} testID="more-logout" danger />
        </Card>
      </ScrollView>
    </View>
  );
}
