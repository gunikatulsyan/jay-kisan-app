import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage, qs } from "@/src/api/client";
import type { Customer, Page, Txn } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { useToast } from "@/src/components/Toast";
import { TxnRow } from "@/src/components/TxnRow";
import { Banner, Button, Card, ErrorView, Field, IconButton, KV, Loading, SectionTitle, Sheet, Txt } from "@/src/components/ui";
import { fmtMoney, fmtQty, fmtRelative } from "@/src/utils/format";
import { spacing, useTheme } from "@/src/theme";

type Summary = { products: { product_id: string; product_name: string; unit?: string; units: number; revenue: number | null; last_at: string | null }[]; total_units: number };

export default function CustomerDetail() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useQuery({ queryKey: ["customer", id], queryFn: () => api<Customer>(`/customers/${id}`) });
  const s = useQuery({ queryKey: ["customer-summary", id], queryFn: () => api<Summary>(`/customers/${id}/summary`) });
  const tx = useQuery({ queryKey: ["transactions", "customer", id], queryFn: () => api<Page<Txn>>(`/transactions${qs({ customer_id: id, limit: 10 })}`) });
  const [edit, setEdit] = useState<{ name: string; phone: string; address: string; tax_id: string } | null>(null);
  const save = useMutation({
    mutationFn: (body: any) => api<Customer>(`/customers/${id}`, { method: "PATCH", body }),
    onSuccess: () => { toast.show({ title: "Customer updated", tone: "success" }); setEdit(null); qc.invalidateQueries({ queryKey: ["customer", id] }); qc.invalidateQueries({ queryKey: ["customers"] }); },
  });
  const d = c.data;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title={d?.name ?? "Customer"} subtitle="Customer profile & purchase history" back
        right={d ? <IconButton icon="create-outline" testID="edit-customer-button" label="Edit" onPress={() => setEdit({ name: d.name, phone: d.phone ?? "", address: d.address ?? "", tax_id: d.tax_id ?? "" })} /> : null} />
      {c.isLoading ? <Loading /> : c.isError || !d ? <ErrorView message={errorMessage(c.error)} onRetry={() => c.refetch()} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 900, width: "100%", alignSelf: "center" }}>
          <Card style={{ gap: 0 }}>
            <KV label="Phone" value={d.phone ?? "—"} />
            <KV label="Address" value={d.address ?? "—"} />
            <KV label="PAN / VAT" value={d.tax_id ?? "—"} />
            <KV label="Status" value={d.active ? "Active" : "Inactive"} />
          </Card>
          <Card style={{ gap: spacing.sm }} testID="customer-purchases">
            <SectionTitle title="Purchases by product" action={<Txt v="bodyMedium" color={colors.brandPrimary}>{fmtQty(s.data?.total_units ?? 0)} units</Txt>} />
            {s.isLoading ? <Loading /> : !s.data?.products.length ? <Txt v="body" color={colors.muted}>No purchases yet.</Txt> : s.data.products.map((p) => (
              <View key={p.product_id} style={{ flexDirection: "row", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.md }}>
                <View style={{ flex: 1 }}>
                  <Txt v="bodyMedium">{p.product_name}</Txt>
                  <Txt v="caption">Last {fmtRelative(p.last_at)} · {p.revenue != null ? fmtMoney(p.revenue) : "price not recorded"}</Txt>
                </View>
                <Txt v="subtitle">{fmtQty(p.units)} {p.unit}</Txt>
              </View>
            ))}
          </Card>
          <View style={{ gap: spacing.sm }}>
            <SectionTitle title="Recent transactions" action={<Button title="View all" size="sm" variant="ghost" onPress={() => router.push({ pathname: "/transactions", params: { customer_id: id } })} testID="customer-all-transactions" />} />
            {tx.data?.items.map((t) => <TxnRow key={t.id} t={t} onPress={() => router.push(`/transaction/${t.id}`)} />)}
          </View>
          <Button title={d.active ? "Deactivate customer" : "Reactivate customer"} variant="ghost" onPress={() => save.mutate({ active: !d.active })} testID="toggle-customer-active" />
        </ScrollView>
      )}
      <Sheet visible={!!edit} onClose={() => setEdit(null)} title="Edit customer" testID="edit-customer-sheet">
        {edit ? (
          <>
            <Field label="Name *" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} testID="edit-customer-name" />
            <Field label="Phone" value={edit.phone} onChangeText={(v) => setEdit({ ...edit, phone: v })} keyboardType="phone-pad" testID="edit-customer-phone" />
            <Field label="Address" value={edit.address} onChangeText={(v) => setEdit({ ...edit, address: v })} testID="edit-customer-address" />
            <Field label="PAN / VAT" value={edit.tax_id} onChangeText={(v) => setEdit({ ...edit, tax_id: v })} testID="edit-customer-tax" />
            {save.isError ? <Banner tone="error" text={errorMessage(save.error)} /> : null}
            <Button title="Save" loading={save.isPending} disabled={!edit.name.trim()} onPress={() => save.mutate({ name: edit.name.trim(), phone: edit.phone.trim() || null, address: edit.address.trim() || null, tax_id: edit.tax_id.trim() || null })} testID="save-customer-edit" />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
