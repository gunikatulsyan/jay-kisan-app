import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ScrollView, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, BACKEND_URL, errorMessage } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { AppHeader } from "@/src/components/AppHeader";
import { useToast } from "@/src/components/Toast";
import { Banner, Button, Card, KV, Loading, SectionTitle, Txt } from "@/src/components/ui";
import { spacing, useTheme } from "@/src/theme";

type Settings = { allow_negative_stock: boolean; require_customer_for_sale: boolean };
type Ready = { status: string; database: string; transactions_supported: boolean; non_transactional_dev_mode: boolean; environment: string; stock_writes_enabled: boolean };

export default function SettingsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { logout } = useAuth();
  const s = useQuery({ queryKey: ["settings"], queryFn: () => api<Settings>("/settings") });
  const ready = useQuery({ queryKey: ["ready"], queryFn: () => api<Ready>("/ready", { auth: false }) });
  const save = useMutation({
    mutationFn: (body: Partial<Settings>) => api<Settings>("/settings", { method: "PATCH", body }),
    onSuccess: (d) => { qc.setQueryData(["settings"], d); toast.show({ title: "Settings saved", tone: "success" }); },
    onError: (e) => toast.show({ title: "Failed", message: errorMessage(e), tone: "error" }),
  });
  const toggle = (label: string, desc: string, key: keyof Settings, testID: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <Txt v="bodyMedium">{label}</Txt>
        <Txt v="caption">{desc}</Txt>
      </View>
      <Switch testID={testID} value={!!s.data?.[key]} onValueChange={(v) => save.mutate({ [key]: v })} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.surfaceSecondary} />
    </View>
  );
  const r = ready.data;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Settings" back />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 820, width: "100%", alignSelf: "center" }}>
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle title="Sales rules" />
          {s.isLoading ? <Loading /> : (
            <>
              {toggle("Require customer for every sale", "Employees must select or create the customer (“Sold to”).", "require_customer_for_sale", "setting-require-customer")}
              {toggle("Allow negative stock", "Not recommended. When off, sales that exceed available stock are rejected.", "allow_negative_stock", "setting-allow-negative")}
              {s.data?.allow_negative_stock ? <Banner tone="warning" text="Negative stock is allowed. Inventory can drop below zero." /> : null}
            </>
          )}
        </Card>
        <Card style={{ gap: 0 }} testID="system-status-card">
          <SectionTitle title="System status" />
          <KV label="API" value={BACKEND_URL.replace(/^https?:\/\//, "")} />
          <KV label="Database" value={r?.database ?? "…"} />
          <KV label="Environment" value={r?.environment ?? "…"} />
          <KV label="MongoDB transactions" value={r ? (r.transactions_supported ? "Supported" : "Not supported") : "…"} testID="tx-supported" />
          <KV label="Stock changes" value={r ? (r.stock_writes_enabled ? "Enabled" : "Disabled") : "…"} />
          {r?.non_transactional_dev_mode ? <View style={{ marginTop: spacing.sm }}><Banner tone="warning" text="Development database without transactions. Stock can never go negative, but production must use MongoDB Atlas (replica set) for full multi-document atomicity." /></View> : null}
        </Card>
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle title="Account security" />
          <Button title="Change password" variant="outline" icon="key-outline" onPress={() => router.push("/change-password")} testID="settings-change-password" />
          <Button title="Sign out of all devices" variant="outline" icon="phone-portrait-outline" onPress={() => logout(true)} testID="settings-logout-all" />
        </Card>
      </ScrollView>
    </View>
  );
}
