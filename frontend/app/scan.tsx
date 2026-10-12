import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError, errorMessage, qs } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppHeader } from "@/src/components/AppHeader";
import { Icon } from "@/src/components/Icon";
import { useToast } from "@/src/components/Toast";
import { Button, Card, Field, Loading, Txt } from "@/src/components/ui";
import { useWarehouse } from "@/src/context/WarehouseContext";
import { radius, spacing, useTheme } from "@/src/theme";

export default function Scan() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { me } = useAuth();
  const { selected } = useWarehouse();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const last = useRef("");
  if (!me) return <Redirect href="/login" />;
  const isOwner = me.user.role === "owner";

  const handle = async (raw: string) => {
    const code = raw.trim();
    if (!code || busy || code === last.current) return;
    last.current = code;
    setBusy(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const r = await api<{ product: { id: string } }>(`/products/lookup${qs({ code, warehouse_id: selected !== "all" ? selected : undefined })}`);
      if (mode === "lookup") router.replace(`/product/${r.product.id}`);
      else router.replace({ pathname: "/sell", params: { product_id: r.product.id } });
    } catch (e) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const notFound = e instanceof ApiError && e.code === "PRODUCT_NOT_FOUND";
      toast.show({
        title: "Product not found", message: errorMessage(e), tone: "error",
        ...(notFound && isOwner ? { actionLabel: "Add product", onAction: () => router.replace({ pathname: "/product-form", params: { barcode: code } }) } : {}),
      });
      setTimeout(() => { last.current = ""; setBusy(false); }, 1500);
    }
  };

  let camera = null;
  if (!permission) camera = <Loading />;
  else if (permission.granted && cameraError) {
    camera = (
      <Card style={{ gap: spacing.sm, alignItems: "center" }} testID="camera-error-card">
        <Icon name="videocam-off-outline" size={30} color={colors.muted} />
        <Txt v="subtitle" style={{ textAlign: "center" }}>Camera not available</Txt>
        <Txt v="body" color={colors.muted} style={{ textAlign: "center" }}>Type the barcode or SKU below instead.</Txt>
      </Card>
    );
  } else if (permission.granted) {
    camera = (
      <View style={{ height: 360, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceInverse }} testID="camera-view">
        <CameraView style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} onMountError={(e) => setCameraError(e.message)}
          barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "code93", "itf14", "qr"] }}
          onBarcodeScanned={busy ? undefined : ({ data }) => handle(data)} />
        <View pointerEvents="none" style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: "75%", height: 140, borderWidth: 3, borderColor: colors.onBrand, borderRadius: radius.md, opacity: 0.9 }} />
          <Txt v="bodyMedium" color={colors.onBrand} style={{ marginTop: spacing.md }}>{busy ? "Looking up…" : "Align the barcode inside the frame"}</Txt>
        </View>
        {Platform.OS !== "web" ? (
          <Pressable testID="torch-toggle" accessibilityLabel={torch ? "Turn flashlight off" : "Turn flashlight on"} onPress={() => setTorch((t) => !t)}
            style={{ position: "absolute", right: spacing.md, bottom: spacing.md, width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center",
              backgroundColor: torch ? colors.onBrand : colors.backdrop }}>
            <Icon name={torch ? "flashlight" : "flashlight-outline"} size={22} color={torch ? colors.brand : colors.onBrand} />
          </Pressable>
        ) : null}
      </View>
    );
  } else {
    const blocked = !permission.canAskAgain;
    camera = (
      <Card style={{ gap: spacing.md, alignItems: "center" }} testID="camera-permission-card">
        <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
          <Icon name="camera-outline" size={30} color={colors.brandPrimary} />
        </View>
        <Txt v="subtitle" style={{ textAlign: "center" }}>{blocked ? "Camera access is turned off" : "Scan barcodes to find products instantly"}</Txt>
        <Txt v="body" color={colors.muted} style={{ textAlign: "center" }}>
          {blocked ? "Enable camera access in Settings to scan barcodes. You can still type the code below." : "Jay Kisan uses the camera only to read product barcodes. Nothing is recorded."}
        </Txt>
        {blocked ? (
          <Button title="Open Settings" icon="settings-outline" onPress={() => Linking.openSettings()} testID="open-settings-button" />
        ) : (
          <Button title={permission.status === "denied" ? "Try again" : "Allow camera"} icon="camera" onPress={requestPermission} testID="allow-camera-button" />
        )}
      </Card>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Scan barcode" subtitle={mode === "lookup" ? "Find a product" : "Sell / deduct stock"} back />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 640, width: "100%", alignSelf: "center" }}>
        {camera}
        <Card style={{ gap: spacing.md }}>
          <Txt v="subtitle">Enter code manually</Txt>
          <Field placeholder="Barcode or SKU" value={manual} onChangeText={setManual} autoCapitalize="characters" autoCorrect={false} onSubmitEditing={() => handle(manual)} testID="manual-code-input" returnKeyType="search" />
          <Button title="Find product" icon="search" onPress={() => { last.current = ""; handle(manual); }} loading={busy} disabled={!manual.trim()} testID="manual-code-submit" />
        </Card>
      </KeyboardAwareScrollView>
    </View>
  );
}
