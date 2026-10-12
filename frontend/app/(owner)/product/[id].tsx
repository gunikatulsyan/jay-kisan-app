import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage, qs } from "@/src/api/client";
import type { Page, Product, Txn } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { useCategoryTree } from "@/src/components/Pickers";
import { useToast } from "@/src/components/Toast";
import { TxnRow } from "@/src/components/TxnRow";
import { Badge, Banner, Button, Card, ErrorView, Field, IconButton, KV, Loading, SectionTitle, Sheet, StatusBadge, Txt } from "@/src/components/ui";
import { useWarehouse } from "@/src/context/WarehouseContext";
import { useIsWide } from "@/src/navigation";
import { fmtMoney, fmtQty } from "@/src/utils/format";
import { radius, spacing, useTheme } from "@/src/theme";

export default function ProductDetail() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const toast = useToast();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { warehouses, setSelected } = useWarehouse();
  const { tree } = useCategoryTree(true);
  const q = useQuery({ queryKey: ["product", id], queryFn: () => api<Product>(`/products/${id}`) });
  const txQ = useQuery({ queryKey: ["transactions", "product", id], queryFn: () => api<Page<Txn>>(`/transactions${qs({ product_id: id, limit: 10 })}`) });
  const [threshold, setThreshold] = useState<{ wid: string; name: string; value: string } | null>(null);
  const [deact, setDeact] = useState(false);
  const [reason, setReason] = useState("");
  const invalidate = () => ["product", "products", "inventory", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const saveThreshold = useMutation({
    mutationFn: () => api("/inventory/threshold", { method: "PUT", body: { product_id: id, warehouse_id: threshold!.wid, min_stock: threshold!.value === "" ? null : parseInt(threshold!.value, 10) } }),
    onSuccess: () => { toast.show({ title: "Threshold saved", tone: "success" }); setThreshold(null); invalidate(); },
  });
  const toggleActive = useMutation({
    mutationFn: (active: boolean) => api(`/products/${id}/${active ? "activate" : "deactivate"}`, { method: "POST", body: active ? undefined : { reason } }),
    onSuccess: () => { toast.show({ title: "Product updated", tone: "success" }); setDeact(false); setReason(""); invalidate(); },
  });

  const p = q.data;
  const catPath = p?.category_id ? tree.find((c) => c.id === p.category_id)?.path : null;
  const action = (type: string, wid: string) => router.push({ pathname: "/stock-action", params: { type, product_id: id, warehouse_id: wid } });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title={p?.name ?? "Product"} subtitle={p ? `${p.sku} · total ${fmtQty(p.stock_total)} ${p.unit}` : undefined} back
        right={p ? <IconButton icon="create-outline" onPress={() => router.push({ pathname: "/product-form", params: { id } })} testID="edit-product-button" label="Edit" /> : null} />
      {q.isLoading ? <Loading /> : q.isError || !p ? <ErrorView message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
          {!p.active ? <Banner tone="warning" text="This product is inactive. Employees cannot sell it. History is preserved." testID="inactive-banner" /> : null}
          <View style={{ flexDirection: wide ? "row" : "column", gap: spacing.lg, alignItems: "flex-start" }}>
            <Card style={{ flex: 1, width: "100%", gap: 0 }} testID="product-info-card">
              <SectionTitle title="Details" action={<StatusBadge status={p.stock_status} />} />
              <KV label="SKU" value={p.sku} testID="product-sku" />
              <KV label="Barcode" value={p.barcode ?? "—"} />
              <KV label="Category" value={catPath ?? "—"} />
              <KV label="Brand" value={p.brand ?? "—"} />
              <KV label="Unit" value={p.unit} />
              <KV label="Supplier" value={p.supplier ?? "—"} />
              <KV label="Purchase price" value={fmtMoney(p.purchase_price)} testID="product-purchase-price" />
              <KV label="Selling price" value={fmtMoney(p.selling_price)} testID="product-selling-price" />
              <KV label="Min stock (default)" value={fmtQty(p.min_stock)} />
              <KV label="Batch" value={p.batch_no ?? "—"} />
              <KV label="Expiry" value={p.expiry_date ?? "—"} />
              {p.description ? <Txt v="body" color={colors.muted} style={{ marginTop: spacing.sm }}>{p.description}</Txt> : null}
            </Card>
            <View style={{ flex: 1.2, width: "100%", gap: spacing.md }}>
              <SectionTitle title="Stock by warehouse" />
              {warehouses.map((w) => {
                const inv = p.inventory?.find((i) => i.warehouse_id === w.id);
                return (
                  <Card key={w.id} style={{ gap: spacing.md }} testID={`stock-card-${w.code}`}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                      <View style={{ flex: 1 }}>
                        <Txt v="subtitle">{w.name}</Txt>
                        <Txt v="caption">Min {fmtQty(inv?.effective_min ?? p.min_stock)}{inv?.min_stock != null ? " (warehouse-specific)" : ""}</Txt>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 4 }}>
                        <Txt v="display" testID={`stock-qty-${w.code}`}>{fmtQty(inv?.quantity ?? 0)}</Txt>
                        <StatusBadge status={inv?.stock_status ?? "out"} />
                      </View>
                    </View>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                      <Button title="Add" icon="add" size="sm" onPress={() => action("in", w.id)} testID={`stock-in-${w.code}`} />
                      <Button title="Remove" icon="trash-outline" size="sm" variant="outline" onPress={() => action("remove", w.id)} testID={`stock-remove-${w.code}`} disabled={!inv?.quantity} />
                      <Button title="Adjust" icon="construct-outline" size="sm" variant="outline" onPress={() => action("adjust", w.id)} testID={`stock-adjust-${w.code}`} />
                      <Button title="Transfer" icon="swap-horizontal" size="sm" variant="outline" onPress={() => action("transfer", w.id)} testID={`stock-transfer-${w.code}`} disabled={!inv?.quantity} />
                      <Button title="Sell" icon="cart-outline" size="sm" variant="secondary" disabled={!p.active || !inv?.quantity} testID={`stock-sell-${w.code}`}
                        onPress={() => { setSelected(w.id); router.push({ pathname: "/sell", params: { product_id: id } }); }} />
                      <Button title="Threshold" icon="speedometer-outline" size="sm" variant="ghost" testID={`stock-threshold-${w.code}`}
                        onPress={() => setThreshold({ wid: w.id, name: w.name, value: inv?.min_stock != null ? String(inv.min_stock) : "" })} />
                    </View>
                  </Card>
                );
              })}
            </View>
          </View>
          <View style={{ gap: spacing.sm }}>
            <SectionTitle title="Recent transactions" action={<Button title="View all" size="sm" variant="ghost" onPress={() => router.push({ pathname: "/transactions", params: { product_id: id } })} testID="product-all-transactions" />} />
            {txQ.data?.items.length ? txQ.data.items.map((t) => <TxnRow key={t.id} t={t} onPress={() => router.push(`/transaction/${t.id}`)} />) : <Txt v="body" color={colors.muted}>No transactions yet.</Txt>}
          </View>
          <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.lg, flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
            <Badge label={p.active ? "ACTIVE" : "INACTIVE"} tone={p.active ? "success" : "neutral"} />
            <View style={{ flex: 1 }} />
            {p.active ? <Button title="Deactivate product" variant="ghost" icon="archive-outline" onPress={() => setDeact(true)} testID="deactivate-product-button" />
              : <Button title="Reactivate" variant="secondary" icon="refresh" loading={toggleActive.isPending} onPress={() => toggleActive.mutate(true)} testID="activate-product-button" />}
          </View>
        </ScrollView>
      )}
      <Sheet visible={!!threshold} onClose={() => setThreshold(null)} title={`Low-stock threshold · ${threshold?.name ?? ""}`} testID="threshold-sheet">
        <Txt v="body" color={colors.muted}>Leave empty to use the product default ({fmtQty(p?.min_stock)}).</Txt>
        <Field label="Minimum quantity" value={threshold?.value ?? ""} onChangeText={(v) => threshold && setThreshold({ ...threshold, value: v.replace(/[^0-9]/g, "") })} keyboardType="number-pad" testID="threshold-input" />
        {saveThreshold.isError ? <Banner tone="error" text={errorMessage(saveThreshold.error)} /> : null}
        <Button title="Save threshold" loading={saveThreshold.isPending} onPress={() => saveThreshold.mutate()} testID="save-threshold-button" />
      </Sheet>
      <Sheet visible={deact} onClose={() => setDeact(false)} title="Deactivate product" testID="deactivate-sheet">
        <Banner tone="warning" text="Products are never deleted. Deactivating hides it from sales; all stock history remains." />
        <Field label="Reason *" value={reason} onChangeText={setReason} placeholder="e.g. Discontinued by supplier" testID="deactivate-reason-input" />
        {toggleActive.isError ? <Banner tone="error" text={errorMessage(toggleActive.error)} /> : null}
        <Button title="Deactivate" variant="danger" disabled={reason.trim().length < 3} loading={toggleActive.isPending} onPress={() => toggleActive.mutate(false)} testID="confirm-deactivate-button" />
      </Sheet>
      <View style={{ height: 0, borderRadius: radius.sm }} />
    </View>
  );
}
