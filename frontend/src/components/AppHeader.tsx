import { router } from "expo-router";
import { ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton, Txt } from "@/src/components/ui";
import { spacing, useTheme } from "@/src/theme";

// Sticky, safe-area aware header. Lives outside the scroll view.
export function AppHeader({ title, subtitle, back, right, children, testID }: {
  title: string; subtitle?: string; back?: boolean; right?: ReactNode; children?: ReactNode; testID?: string;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID} style={{ paddingTop: insets.top + spacing.sm, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm, minHeight: 52, gap: spacing.xs }}>
        {back ? (
          <IconButton icon="arrow-back" testID="header-back-button" label="Back"
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        ) : <View style={{ width: spacing.sm }} />}
        <View style={{ flex: 1 }}>
          <Txt v="title" numberOfLines={1}>{title}</Txt>
          {subtitle ? <Txt v="caption" numberOfLines={1}>{subtitle}</Txt> : null}
        </View>
        {right ? <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>{right}</View> : null}
      </View>
      {children}
    </View>
  );
}
