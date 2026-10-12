import { Platform, useWindowDimensions } from "react-native";

export const usesNativeTabs = Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

export function useIsWide() {
  const { width } = useWindowDimensions();
  return width >= 1024;
}
