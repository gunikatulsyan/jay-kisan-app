import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform } from "react-native";

import { Icon, IconName } from "@/src/components/Icon";
import { useIsWide, usesNativeTabs } from "@/src/navigation";
import { useUnreadCount } from "@/src/realtime/RealtimeProvider";
import { fonts, useTheme } from "@/src/theme";

const TABS: { name: string; title: string; icon: IconName; sf: string }[] = [
  { name: "dashboard", title: "Dashboard", icon: "grid", sf: "square.grid.2x2.fill" },
  { name: "inventory", title: "Inventory", icon: "cube", sf: "shippingbox.fill" },
  { name: "alerts", title: "Alerts", icon: "notifications", sf: "bell.fill" },
  { name: "more", title: "More", icon: "menu", sf: "line.3.horizontal" },
];

export default function OwnerTabs() {
  const { colors } = useTheme();
  const wide = useIsWide();
  const unread = useUnreadCount();

  if (wide) {
    // Desktop: the persistent sidebar replaces the tab bar.
    return <Tabs tabBar={() => null} screenOptions={{ headerShown: false }} />;
  }
  if (usesNativeTabs) {
    return (
      <NativeTabs>
        {TABS.map((t) => (
          <NativeTabs.Trigger key={t.name} name={t.name}>
            <NativeTabs.Trigger.Icon sf={t.sf as any} />
            <NativeTabs.Trigger.Label>{t.title}</NativeTabs.Trigger.Label>
          </NativeTabs.Trigger>
        ))}
      </NativeTabs>
    );
  }
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surfaceSecondary, borderTopColor: colors.border, ...(Platform.OS === "web" ? { height: 64 } : {}) },
        tabBarItemStyle: { alignSelf: "center" },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{
          title: t.title,
          tabBarButtonTestID: `tab-${t.name}`,
          tabBarBadge: t.name === "alerts" && unread > 0 ? unread : undefined,
          tabBarIcon: ({ color, focused }) => <Icon name={(focused ? t.icon : `${t.icon}-outline`) as IconName} color={color as string} size={22} />,
        }} />
      ))}
    </Tabs>
  );
}
