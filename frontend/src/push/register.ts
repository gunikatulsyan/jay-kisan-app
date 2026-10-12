// Registers this device's native push token (FCM/APNs) with the backend relay.
// Native builds only — push does not work in Expo Go or on web.
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { BACKEND_URL, getAccessToken } from "@/src/api/client";

export const pushSupported =
  Platform.OS !== "web" && Device.isDevice && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

export async function registerPush(userId: string) {
  try {
    const { data } = await Notifications.getDevicePushTokenAsync();
    await fetch(`${BACKEND_URL}/api/register-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken()}` },
      body: JSON.stringify({ user_id: userId, platform: Platform.OS, device_token: data }),
    });
  } catch (e) {
    console.warn("[push] registration failed", e);
  }
}
