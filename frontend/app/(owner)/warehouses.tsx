import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage } from "@/src/api/client";
import type { Warehouse } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { AppHeader } from "@/src/components/AppHeader";
import { useToast } from "@/src/components/Toast";
import { Badge, Banner, Button, Card, ErrorView, Field, Loading, Sheet, Txt } from "@/src/components/ui";
import { radius, spacing, useTheme } from "@/src/theme";

type Form = { id?: string; name: string; code: string; address: string; phone: string };

export default function Warehouses() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { refreshMe } = useAuth();
  const q = useQuery({ queryKey: ["warehouses", "all"], queryFn: () => api<Warehouse[]>("/warehouses?include_inactive=true") });
  const [form, setForm] = useState<Form | null>(null);
  const after = (title: string) => { toast.show({ title, tone: "success" }); setForm(null); qc.invalidateQueries({ queryKey: ["warehouses"] }); refreshMe(); };
  const save = useMutation({
    mutationFn: () => form!.id
      ? api(`/warehouses/${form!.id}`, { method: "PATCH", body: { name: form!.name.trim(), address: form!.address.trim() || null, phone: form!.phone.trim() || null } })
      : api("/warehouses", { method: "POST", body: { name: form!.name.trim(), code: form!.code.trim().toUpperCase(), address: form!.address.trim() || null, phone: form!.phone.trim() || null } }),
    onSuccess: () => after(form?.id ? "Warehouse updated" : "Warehouse created"),
  });
  const toggle = useMutation({ mutationFn: (w: Warehouse) => api(`/warehouses/${w.id}`, { method: "PATCH", body: { active: !w.active } }), onSuccess: () => after("Warehouse updated") });
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Warehouses" back right={<Button title="New" size="sm" icon="add" onPress={() => setForm({ name: "", code: "", address: "", phone: "" })} testID="add-warehouse-button" />} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl, maxWidth: 820, width: "100%", alignSelf: "center" }}>
        {q.isLoading ? <Loading /> : q.isError ? <ErrorView message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : q.data!.map((w) => (
          <Card key={w.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }} testID={`warehouse-card-${w.code}`}>
            <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
              <Txt v="bodyMedium" color={colors.brand}>{w.code}</Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt v="subtitle">{w.name}</Txt>
              <Txt v="caption">{[w.address, w.phone].filter(Boolean).join(" · ") || "—"}</Txt>
            </View>
            <Badge label={w.active ? "ACTIVE" : "INACTIVE"} tone={w.active ? "success" : "neutral"} />
            <Button title="Edit" size="sm" variant="outline" onPress={() => setForm({ id: w.id, name: w.name, code: w.code, address: w.address ?? "", phone: w.phone ?? "" })} testID={`edit-warehouse-${w.code}`} />
            <Button title={w.active ? "Deactivate" : "Activate"} size="sm" variant="ghost" onPress={() => toggle.mutate(w)} testID={`toggle-warehouse-${w.code}`} />
          </Card>
        ))}
      </ScrollView>
      <Sheet visible={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit warehouse" : "New warehouse"} testID="warehouse-form-sheet">
        {form ? (
          <>
            <Field label="Name *" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="e.g. Kathmandu Warehouse" testID="warehouse-name-input" />
            <Field label="Code * (short, unique)" value={form.code} editable={!form.id} onChangeText={(v) => setForm({ ...form, code: v.toUpperCase() })} placeholder="KTM" autoCapitalize="characters" testID="warehouse-code-input" />
            <Field label="Address" value={form.address} onChangeText={(v) => setForm({ ...form, address: v })} testID="warehouse-address-input" />
            <Field label="Phone" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" testID="warehouse-phone-input" />
            {save.isError ? <Banner tone="error" text={errorMessage(save.error)} /> : null}
            <Button title="Save warehouse" loading={save.isPending} disabled={form.name.trim().length < 2 || form.code.trim().length < 2} onPress={() => save.mutate()} testID="save-warehouse-button" />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
