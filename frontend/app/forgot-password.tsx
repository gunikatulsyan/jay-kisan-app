import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage } from "@/src/api/client";
import { AppHeader } from "@/src/components/AppHeader";
import { useToast } from "@/src/components/Toast";
import { Banner, Button, Field } from "@/src/components/ui";
import { spacing, useTheme } from "@/src/theme";

export default function ForgotPassword() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [f, setF] = useState({ username: "", code: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (f.password !== f.confirm) return setError("Passwords do not match");
    setBusy(true);
    setError(null);
    try {
      await api("/auth/reset-password", { method: "POST", auth: false, body: { username: f.username.trim(), code: f.code.trim(), new_password: f.password } });
      toast.show({ title: "Password updated", message: "Sign in with your new password.", tone: "success" });
      router.replace("/login");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Reset password" back />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.xl, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 480, width: "100%", alignSelf: "center" }}>
        <Banner tone="neutral" text="Ask the owner for a one-time reset code (valid for 30 minutes). Staff accounts cannot be reset by email or SMS." />
        {error ? <Banner tone="error" text={error} testID="reset-error" /> : null}
        <Field label="Employee ID / Username" value={f.username} onChangeText={(v) => setF({ ...f, username: v })} autoCapitalize="none" testID="reset-username-input" />
        <Field label="Reset code" value={f.code} onChangeText={(v) => setF({ ...f, code: v.toUpperCase() })} autoCapitalize="characters" testID="reset-code-input" />
        <Field label="New password" value={f.password} onChangeText={(v) => setF({ ...f, password: v })} secureTextEntry hint="At least 8 characters with letters and numbers" testID="reset-new-password-input" />
        <Field label="Confirm new password" value={f.confirm} onChangeText={(v) => setF({ ...f, confirm: v })} secureTextEntry testID="reset-confirm-password-input" />
        <Button title="Set new password" size="lg" loading={busy} onPress={submit} disabled={!f.username || !f.code || !f.password} testID="reset-submit-button" />
      </KeyboardAwareScrollView>
    </View>
  );
}
