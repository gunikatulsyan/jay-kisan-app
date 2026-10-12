import { Ionicons } from "@react-native-vector-icons/ionicons";
import type { ComponentProps } from "react";

import { useTheme } from "@/src/theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  return <Ionicons name={name} size={size} color={color ?? colors.onSurface} />;
}
