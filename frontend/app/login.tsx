import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { errorMessage } from "@/src/api/client";
import { homeFor, useAuth } from "@/src/auth/AuthContext";
import { Icon } from "@/src/components/Icon";
import { Banner, Button, Field, Txt } from "@/src/components/ui";
import { useIsWide } from "@/src/navigation";
import { radius, spacing, useTheme } from "@/src/theme";

const HERO = "https://images.unsplash.com/photo-1553413077-190dd305871c?crop=entropy&cs=srgb&fm=jpg&w=1200&q=70";

export default function Login() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const { me, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me) return <Redirect href={homeFor(me)} />;

  const submit = async () => {
    if (!username.trim() || !password) return setError("Enter your Employee ID and password");
    setBusy(true);
    setError(null);
    try {
      const m = await login(username.trim(), password);
      router.replace(homeFor(m));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const hero = (
    <View style={{ height: wide ? "100%" : 220 + insets.top, overflow: "hidden", flex: wide ? 1 : undefined }}>
      <Image source={{ uri: HERO }} style={{ position: "absolute", width: "100%", height: "100%" }} contentFit="cover" transition={300} />
      <LinearGradient colors={["rgba(20,83,45,0.35)", "rgba(20,83,45,0.92)"]} style={{ position: "absolute", width: "100%", height: "100%" }} />
      <View style={{ flex: 1, justifyContent: "flex-end", padding: spacing.xl, paddingTop: insets.top + spacing.lg }}>
        <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.onBrand, alignItems: "center", justifyContent: "center", marginBottom: spacing.md }}>
          <Icon name="leaf" size={26} color={colors.brand} />
        </View>
        <Txt v="display" color={colors.onBrand}>Jay Kisan</Txt>
        <Txt v="body" color={colors.brandSecondary}>Inventory · Sales · Warehouses</Txt>
      </View>
    </View>
  );

  const form = (
    <View style={{ padding: spacing.xl, gap: spacing.lg, width: "100%", maxWidth: 440, alignSelf: "center" }}>
      <View style={{ gap: spacing.xs }}>
        <Txt v="title">Sign in</Txt>
        <Txt v="body" color={colors.muted}>Use the Employee ID and password given by the owner.</Txt>
      </View>
      {error ? <Banner tone="error" text={error} testID="login-error" /> : null}
      <Field label="Employee ID / Username" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false}
        placeholder="e.g. rahul" testID="login-username-input" returnKeyType="next" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} placeholder="Password"
        testID="login-password-input" onSubmitEditing={submit} returnKeyType="go"
        right={<Pressable onPress={() => setShow(!show)} style={{ padding: spacing.md }} testID="toggle-password-visibility"><Icon name={show ? "eye-off-outline" : "eye-outline"} color={colors.muted} /></Pressable>} />
      <Button title="Sign in" size="lg" onPress={submit} loading={busy} testID="login-submit-button" />
      <Pressable onPress={() => router.push("/forgot-password")} testID="forgot-password-link" style={{ alignSelf: "center", padding: spacing.sm }}>
        <Txt v="bodyMedium" color={colors.brandPrimary}>Forgot password?</Txt>
      </Pressable>
    </View>
  );

  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: "row", backgroundColor: colors.surfaceSecondary }}>
        {hero}
        <View style={{ flex: 1, justifyContent: "center" }}>{form}</View>
      </View>
    );
  }
  return (
    <KeyboardAwareScrollView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}>
      {hero}
      {form}
    </KeyboardAwareScrollView>
  );
}
