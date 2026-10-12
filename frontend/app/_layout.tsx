import { QueryClientProvider } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useFonts } from "expo-font";
import * as Notifications from "expo-notifications";
import { Href, router, Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ReactNode, useEffect, useState } from "react";
import { LogBox, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "@/src/auth/AuthContext";
import { ErrorBoundary } from "@/src/components/error-boundary";
import { OwnerShell } from "@/src/components/OwnerShell";
import { ToastProvider } from "@/src/components/Toast";
import { Button, ErrorView, Loading, Sheet, Txt } from "@/src/components/ui";
import { WarehouseProvider } from "@/src/context/WarehouseContext";
import { useIsWide } from "@/src/navigation";
import { pushSupported, registerPush } from "@/src/push/register";
import { queryClient } from "@/src/query-client";
import { RealtimeProvider } from "@/src/realtime/RealtimeProvider";
import { spacing, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true);

// Push display while the app is open: the live in-app toast already alerts the owner,
// so keep it in the notification list without a duplicate banner/sound.
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: false,
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// Android channel must exist before any push arrives.
if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "Stock alerts",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  });
}

const NO_SHELL = ["/", "/login", "/forgot-password", "/change-password"];

function Shell({ children }: { children: ReactNode }) {
  const { me, ready, bootError, retryBoot } = useAuth();
  const { colors } = useTheme();
  const wide = useIsWide();
  const path = usePathname();
  // Hold every route (incl. deep links / hard refresh) until the saved session is restored,
  // so route guards never redirect before we know who is signed in.
  if (!ready || bootError) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.surface }}>
        {bootError ? <ErrorView message={bootError} onRetry={retryBoot} /> : <Loading label="Loading Jay Kisan…" />}
      </View>
    );
  }
  const show = !!me && me.user.role === "owner" && !me.user.must_change_password && wide && !NO_SHELL.includes(path);
  return (
    <>
      <OwnerShell show={show}>{children}</OwnerShell>
      <PushHandlers />
    </>
  );
}

function openFromPush(response: Notifications.NotificationResponse | null) {
  const data = (response?.notification.request.content.data ?? {}) as { deeplink?: string; action_url?: string };
  const url = data.deeplink || data.action_url;
  if (!url) return;
  if (url.startsWith("http")) Linking.openURL(url);
  else router.push(url as Href);
}

const PUSH_ASKS_KEY = "jk.pushAskCount";
const PUSH_NUDGE_KEY = "pushNudgeAt";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Owner push alerts: tap handling, contextual permission ask and token registration.
function PushHandlers() {
  const { me } = useAuth();
  const [prompt, setPrompt] = useState<"ask" | "settings" | null>(null);
  const ownerId = me && me.user.role === "owner" && !me.user.must_change_password ? me.user.id : null;

  useEffect(() => {
    if (Platform.OS === "web") return;
    // Warm tap: app open or in background.
    const tapSub = Notifications.addNotificationResponseReceivedListener(openFromPush);
    // Cold start: app was killed when the notification was tapped.
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (!r) return;
      openFromPush(r);
      Notifications.clearLastNotificationResponse();
    });
    return () => tapSub.remove();
  }, []);

  useEffect(() => {
    if (!ownerId || !pushSupported) return;
    (async () => {
      const perm = await Notifications.getPermissionsAsync();
      if (perm.granted) return registerPush(ownerId); // re-register on every open (tokens rotate)
      if (perm.canAskAgain) {
        // Pre-permission explanation first; at most twice (first ask + one retry).
        if (((await storage.getItem(PUSH_ASKS_KEY, 0)) ?? 0) < 2) setPrompt("ask");
        return;
      }
      const last = (await storage.getItem(PUSH_NUDGE_KEY, 0)) ?? 0;
      if (Date.now() - Number(last) > WEEK_MS) setPrompt("settings");
    })();
  }, [ownerId]);

  if (!prompt) return null;
  const close = async () => {
    setPrompt(null);
    if (prompt === "ask") await storage.setItem(PUSH_ASKS_KEY, ((await storage.getItem(PUSH_ASKS_KEY, 0)) ?? 0) + 1);
    else await storage.setItem(PUSH_NUDGE_KEY, Date.now());
  };
  const allow = async () => {
    await close();
    if (prompt === "settings") return Linking.openSettings();
    const { granted } = await Notifications.requestPermissionsAsync();
    if (granted && ownerId) registerPush(ownerId);
  };
  return (
    <Sheet visible onClose={close} title={prompt === "ask" ? "Get stock alerts on your phone" : "Stock alerts are turned off"} testID="push-permission-sheet">
      <Txt v="body">
        {prompt === "ask"
          ? "Know instantly when an employee sells or deducts stock, and when an item runs low — even when Jay Kisan is closed."
          : "Turn on notifications in Settings to get instant alerts for every sale and low-stock item."}
      </Txt>
      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <Button title="Not now" variant="outline" size="lg" style={{ flex: 1 }} onPress={close} testID="push-later-button" />
        <Button title={prompt === "ask" ? "Turn on alerts" : "Open Settings"} size="lg" style={{ flex: 1.4 }} onPress={allow} testID="push-allow-button" />
      </View>
    </Sheet>
  );
}

export default function RootLayout() {
  const { colors } = useTheme();
  const [loaded, error] = useFonts({
    "PlusJakartaSans-Regular": require("../assets/fonts/PlusJakartaSans-Regular.ttf"),
    "PlusJakartaSans-Medium": require("../assets/fonts/PlusJakartaSans-Medium.ttf"),
  });
  if (!loaded && !error) return null;
  // One app level ErrorBoundary; a render crash shows a reload screen
  // instead of a blank app.
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            <KeyboardProvider>
              <ToastProvider>
                <AuthProvider>
                  <WarehouseProvider>
                    <RealtimeProvider>
                      <StatusBar style="dark" />
                      <Shell>
                        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
                      </Shell>
                    </RealtimeProvider>
                  </WarehouseProvider>
                </AuthProvider>
              </ToastProvider>
            </KeyboardProvider>
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
