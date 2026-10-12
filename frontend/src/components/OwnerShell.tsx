import { router, usePathname } from "expo-router";
import { ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { useAuth } from "@/src/auth/AuthContext";
import { Icon, IconName } from "@/src/components/Icon";
import { Txt } from "@/src/components/ui";
import { useUnreadCount } from "@/src/realtime/RealtimeProvider";
import { radius, spacing, useTheme } from "@/src/theme";

export const OWNER_NAV: { href: string; label: string; icon: IconName; group?: string }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "grid-outline" },
  { href: "/inventory", label: "Inventory", icon: "cube-outline" },
  { href: "/sell", label: "Sell / Deduct", icon: "cart-outline" },
  { href: "/transactions", label: "Transactions", icon: "swap-horizontal-outline" },
  { href: "/alerts", label: "Notifications", icon: "notifications-outline" },
  { href: "/reports", label: "Reports", icon: "bar-chart-outline", group: "Insights" },
  { href: "/audit", label: "Audit log", icon: "shield-checkmark-outline" },
  { href: "/customers", label: "Customers", icon: "people-outline", group: "Manage" },
  { href: "/categories", label: "Categories", icon: "git-network-outline" },
  { href: "/warehouses", label: "Warehouses", icon: "business-outline" },
  { href: "/employees", label: "Employees", icon: "id-card-outline" },
  { href: "/import", label: "Bulk import", icon: "cloud-upload-outline" },
  { href: "/settings", label: "Settings", icon: "settings-outline" },
];

// Desktop admin shell (≥1024px): persistent 240px sidebar. The children slot keeps a stable
// position in the tree so toggling the sidebar never remounts the navigator.
export function OwnerShell({ children, show }: { children: ReactNode; show: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.surface }}>
      {show ? <Sidebar /> : null}
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

function Sidebar() {
  const { colors } = useTheme();
  const { me, logout } = useAuth();
  const path = usePathname();
  const unread = useUnreadCount();
  return (
      <View style={{ width: 240, backgroundColor: colors.surfaceSecondary, borderRightWidth: 1, borderRightColor: colors.border }} testID="owner-sidebar">
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" }}>
            <Icon name="leaf" size={20} color={colors.onBrand} />
          </View>
          <View>
            <Txt v="subtitle">Jay Kisan</Txt>
            <Txt v="caption">Owner console</Txt>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.sm, gap: 2 }}>
          {OWNER_NAV.map((n) => {
            const active = path === n.href || path.startsWith(n.href + "/") || (n.href === "/inventory" && path.startsWith("/product"));
            return (
              <View key={n.href}>
                {n.group ? <Txt v="label" style={{ paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xs }}>{n.group}</Txt> : null}
                <Pressable testID={`sidebar-${n.href.slice(1)}`} onPress={() => router.navigate(n.href as any)}
                  style={({ hovered }: any) => ({ flexDirection: "row", alignItems: "center", gap: spacing.md, height: 40, paddingHorizontal: spacing.md, borderRadius: radius.sm,
                    backgroundColor: active ? colors.brandSecondary : hovered ? colors.surfaceTertiary : "transparent" })}>
                  <Icon name={(active ? n.icon.replace("-outline", "") : n.icon) as IconName} size={18} color={active ? colors.brand : colors.onSurfaceSecondary} />
                  <Txt v={active ? "bodyMedium" : "body"} color={active ? colors.brand : colors.onSurfaceSecondary} style={{ flex: 1 }}>{n.label}</Txt>
                  {n.href === "/alerts" && unread > 0 ? (
                    <View style={{ backgroundColor: colors.error, borderRadius: radius.pill, paddingHorizontal: 6, minWidth: 20, alignItems: "center" }}>
                      <Txt v="caption" color={colors.onError}>{String(unread)}</Txt>
                    </View>
                  ) : null}
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
        <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Txt v="bodyMedium" numberOfLines={1}>{me?.user.full_name}</Txt>
            <Txt v="caption">@{me?.user.username}</Txt>
          </View>
          <Pressable testID="sidebar-logout" onPress={() => logout()} hitSlop={8} style={{ padding: spacing.sm }}>
            <Icon name="log-out-outline" color={colors.muted} />
          </Pressable>
        </View>
      </View>
  );
}
