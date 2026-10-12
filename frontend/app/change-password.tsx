import { Redirect, router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage } from "@/src/api/client";
import { homeFor, useAuth } from "@/src/auth/AuthContext";
import { AppHeader } from "@/src/components/AppHeader";
import { useToast } from "@/src/components/Toast";
import { Banner, Button, Field } from "@/src/components/ui";
import { spacing, useTheme } from "@/src/theme";

export default function ChangePassword() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { me, applyTokens, logout } = useAuth();
  const [f, setF] = useState({ current: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return <Redirect href="/login" />;
  const forced = me.user.must_change_password;

  const submit = async () => {
    if (f.password !== f.confirm) return setError("New passwords do not match");
    setBusy(true);
    setError(null);
    try {
      const t = await api("/auth/change-password", { method: "POST", body: { current_password: f.current, new_password: f.password } });
      const m = await applyTokens(t);
      toast.show({ title: "Password changed", message: "Other devices have been signed out.", tone: "success" });
      router.replace(homeFor(m));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Change password" back={!forced} />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 480, width: "100%", alignSelf: "center" }}>
        {forced ? <Banner tone="warning" text="For security, please set a new password before continuing." testID="forced-change-banner" /> : null}
        {error ? <Banner tone="error" text={error} testID="change-password-error" /> : null}
        <Field label="Current password" value={f.current} onChangeText={(v) => setF({ ...f, current: v })} secureTextEntry testID="current-password-input" />
        <Field label="New password" value={f.password} onChangeText={(v) => setF({ ...f, password: v })} secureTextEntry hint="At least 8 characters with letters and numbers" testID="new-password-input" />
        <Field label="Confirm new password" value={f.confirm} onChangeText={(v) => setF({ ...f, confirm: v })} secureTextEntry testID="confirm-password-input" />
        <Button title="Update password" size="lg" loading={busy} onPress={submit} disabled={!f.current || !f.password} testID="change-password-submit" />
        {forced ? <Button title="Sign out" variant="ghost" onPress={() => logout()} testID="change-password-logout" /> : null}
      </KeyboardAwareScrollView>
    </View>
  );
}
