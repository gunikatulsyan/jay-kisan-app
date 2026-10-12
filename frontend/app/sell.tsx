import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, Pressable, TextInput, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError, errorMessage, newIdempotencyKey } from "@/src/api/client";
import type { Customer, Product, StockResult } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { AppHeader } from "@/src/components/AppHeader";
import { Icon } from "@/src/components/Icon";
import { CustomerPicker } from "@/src/components/Pickers";
import { ProductFinder } from "@/src/components/ProductFinder";
import { Banner, Button, Card, Chip, ErrorView, Field, KV, Loading, Sheet, StatusBadge, Txt } from "@/src/components/ui";
import { WarehousePicker } from "@/src/components/WarehousePicker";
import { useWarehouse } from "@/src/context/WarehouseContext";
import { fmtMoney, fmtQty } from "@/src/utils/format";
import { fonts, radius, spacing, useTheme } from "@/src/theme";

const BAR_H = 88;

export default function Sell() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { selected, current } = useWarehouse();
  const { product_id } = useLocalSearchParams<{ product_id?: string }>();
  const warehouseId = selected !== "all" ? selected : null;

  const productQ = useQuery({ queryKey: ["product", product_id], queryFn: () => api<Product>(`/products/${product_id}`), enabled: !!product_id && !!me });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: () => api<{ require_customer_for_sale: boolean }>("/settings"), enabled: !!me });
  const [qtyText, setQtyText] = useState("1");
  const [price, setPrice] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [idemKey, setIdemKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StockResult | null>(null);

  const qty = parseInt(qtyText || "0", 10) || 0;
  const product = productQ.data;
  const inv = product?.inventory?.find((i) => i.warehouse_id === warehouseId);
  const available = inv?.quantity ?? 0;
  const priceNum = price.trim() === "" ? null : Number(price);
  const priceInvalid = priceNum !== null && (isNaN(priceNum) || priceNum < 0);
  const needCustomer = settingsQ.data?.require_customer_for_sale ?? true;

  // Any change to the sale details = a new logical request (new idempotency key).
  useEffect(() => setIdemKey(null), [qty, price, customer?.id, warehouseId, product_id]);
  useEffect(() => { setResult(null); setQtyText("1"); setPrice(""); setError(null); }, [product_id]);

  const sale = useMutation({
    mutationFn: (key: string) => api<StockResult>("/stock/sale", {
      method: "POST", idempotencyKey: key,
      body: { product_id, warehouse_id: warehouseId, quantity: qty, customer_id: customer?.id ?? null, unit_price: priceNum },
    }),
    onSuccess: (r) => {
      setConfirmOpen(false);
      setResult(r);
      setIdemKey(null);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      ["product", "inventory", "products", "transactions", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "NETWORK") {
        setError("No internet connection — sale not completed. Check your connection and tap Confirm again (it will not be recorded twice).");
        return; // keep the same key so a retry can never duplicate
      }
      setIdemKey(null);
      setError(errorMessage(e));
      if (e instanceof ApiError && e.code === "INSUFFICIENT_STOCK") productQ.refetch();
    },
  });

  if (!me) return <Redirect href="/login" />;

  if (!product_id) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <AppHeader title="Sell / Deduct stock" back />
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 720, width: "100%", alignSelf: "center" }}>
          <WarehousePicker allowAll={false} />
          {!warehouseId ? <Banner tone="warning" text="Choose a warehouse to sell from." testID="choose-warehouse-banner" /> : null}
          <ProductFinder warehouseId={warehouseId} onPick={(id) => router.setParams({ product_id: id })} />
        </KeyboardAwareScrollView>
      </View>
    );
  }

  if (result) {
    const t = result.transaction;
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <AppHeader title="Sale recorded" />
        <KeyboardAwareScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 640, width: "100%", alignSelf: "center" }}>
          <View style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg }} testID="sale-success">
            <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.successSoft, alignItems: "center", justifyContent: "center" }}>
              <Icon name="checkmark-circle" size={64} color={colors.success} />
            </View>
            <Txt v="display">Sale completed</Txt>
            <Txt v="body" color={colors.muted}>Transaction ID</Txt>
            <Txt v="title" testID="sale-success-txn-no" selectable>{t.txn_no}</Txt>
          </View>
          <Card>
            <KV label="Product" value={t.product_name} />
            <KV label="Warehouse" value={t.warehouse_name ?? ""} />
            <KV label="Quantity sold" value={`${fmtQty(-t.quantity_change)} ${t.unit ?? ""}`} strong testID="sale-success-qty" />
            <KV label="Sold to" value={t.customer_name ?? "—"} />
            <KV label="Stock" value={`${fmtQty(t.quantity_before)} → ${fmtQty(t.quantity_after)}`} testID="sale-success-stock" />
            {t.total_amount != null ? <KV label="Total" value={fmtMoney(t.total_amount)} /> : null}
          </Card>
          <Button title="Scan next product" icon="barcode-outline" size="xl" onPress={() => router.replace("/scan")} testID="sale-scan-next" />
          <Button title="Search another product" variant="outline" size="lg" onPress={() => router.replace("/sell")} testID="sale-search-next" />
          <Button title="Done" variant="ghost" onPress={() => router.replace(me.user.role === "owner" ? "/dashboard" : "/home")} testID="sale-done" />
        </KeyboardAwareScrollView>
      </View>
    );
  }

  const overStock = qty > available;
  const canReview = !!warehouseId && !!product && qty > 0 && !overStock && !priceInvalid && (!needCustomer || !!customer);
  const setQty = (n: number) => setQtyText(String(Math.max(0, Math.min(n, 10_000_000))));
  const openConfirm = () => {
    setError(null);
    setIdemKey((k) => k ?? newIdempotencyKey());
    setConfirmOpen(true);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Sell / Deduct stock" subtitle={current?.name} back />
      {productQ.isLoading ? <Loading /> : productQ.isError || !product ? <ErrorView message={errorMessage(productQ.error)} onRetry={() => productQ.refetch()} /> : (
        <KeyboardAwareScrollView bottomOffset={BAR_H + 16} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: BAR_H + insets.bottom + spacing.lg, maxWidth: 720, width: "100%", alignSelf: "center" }}>
          {!warehouseId ? <><WarehousePicker allowAll={false} /><Banner tone="warning" text="Choose a warehouse to sell from." /></> : null}
          <Card style={{ gap: spacing.md }} testID="sell-product-card">
            <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt v="title" testID="sell-product-name">{product.name}</Txt>
                <Txt v="caption">{product.sku}{product.barcode ? ` · ${product.barcode}` : ""} · per {product.unit}</Txt>
              </View>
              <Pressable onPress={() => router.replace("/sell")} testID="change-product-button" hitSlop={8}><Txt v="bodyMedium" color={colors.brandPrimary}>Change</Txt></Pressable>
            </View>
            <View style={{ backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs }}>
              <Txt v="label" color={colors.onBrandTertiary}>Available in {current?.name ?? "warehouse"}</Txt>
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.sm }}>
                <Txt v="hero" color={available > 0 ? colors.brand : colors.error} testID="sell-available-qty">{fmtQty(available)}</Txt>
                <Txt v="subtitle" color={colors.onBrandTertiary} style={{ marginBottom: 8 }}>{product.unit}</Txt>
              </View>
              <StatusBadge status={inv?.stock_status ?? "out"} />
            </View>
          </Card>

          <Card style={{ gap: spacing.md }}>
            <Txt v="subtitle">Quantity sold</Txt>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <Pressable testID="qty-decrement" onPress={() => setQty(qty - 1)} style={({ pressed }) => ({ width: 64, height: 64, borderRadius: radius.md, backgroundColor: pressed ? colors.brandSecondary : colors.surfaceTertiary, alignItems: "center", justifyContent: "center" })}>
                <Icon name="remove" size={28} />
              </Pressable>
              <TextInput testID="qty-input" value={qtyText} onChangeText={(v) => setQtyText(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" selectTextOnFocus
                style={{ flex: 1, height: 64, borderRadius: radius.md, borderWidth: 1.5, borderColor: overStock ? colors.error : colors.borderStrong, textAlign: "center", fontFamily: fonts.medium, fontSize: 32, color: colors.onSurface, backgroundColor: colors.surfaceSecondary }} />
              <Pressable testID="qty-increment" onPress={() => setQty(qty + 1)} style={({ pressed }) => ({ width: 64, height: 64, borderRadius: radius.md, backgroundColor: pressed ? colors.brandPrimary : colors.brandSecondary, alignItems: "center", justifyContent: "center" })}>
                <Icon name="add" size={28} color={colors.brand} />
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
              {[5, 10, 25, 50].map((n) => <Chip key={n} label={`+${n}`} onPress={() => setQty(qty + n)} testID={`qty-add-${n}`} />)}
              {available > 0 ? <Chip label={`All (${fmtQty(available)})`} onPress={() => setQty(available)} testID="qty-all" /> : null}
            </View>
            {overStock ? <Banner tone="error" text={`Only ${fmtQty(available)} ${product.unit} available in this warehouse`} testID="qty-over-stock-error" /> : null}
          </Card>

          <Card style={{ gap: spacing.md }}>
            <Txt v="subtitle">Sold to {needCustomer ? "*" : "(optional)"}</Txt>
            {customer ? (
              <Pressable onPress={() => setPickerOpen(true)} testID="selected-customer" style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary }}>
                <Icon name="person-circle-outline" size={32} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Txt v="subtitle">{customer.name}</Txt>
                  <Txt v="caption">{customer.phone ?? customer.address ?? ""}</Txt>
                </View>
                <Txt v="bodyMedium" color={colors.brandPrimary}>Change</Txt>
              </Pressable>
            ) : (
              <Button title="Select or create customer" icon="person-add-outline" variant="outline" size="lg" onPress={() => setPickerOpen(true)} testID="select-customer-button" />
            )}
          </Card>

          <Card style={{ gap: spacing.md }}>
            <Txt v="subtitle">Selling price per {product.unit} (optional)</Txt>
            <Field placeholder="Rs. — leave empty if unknown" value={price} onChangeText={(v) => setPrice(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" testID="sale-price-input"
              error={priceInvalid ? "Enter a valid amount" : null} hint={priceNum != null && !priceInvalid && qty > 0 ? `Total: ${fmtMoney(priceNum * qty)}` : undefined} />
            {product.selling_price != null && price === "" ? (
              <Chip label={`Use listed price ${fmtMoney(product.selling_price)}`} icon="pricetag-outline" onPress={() => setPrice(String(product.selling_price))} testID="use-listed-price" />
            ) : null}
          </Card>
          {error && !confirmOpen ? <Banner tone="error" text={error} testID="sale-error" /> : null}
        </KeyboardAwareScrollView>
      )}

      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Button title={qty > 0 ? `Review sale · ${fmtQty(qty)} ${product?.unit ?? ""}` : "Enter quantity"} size="xl" disabled={!canReview} onPress={openConfirm} testID="review-sale-button" style={{ maxWidth: 720, width: "100%", alignSelf: "center" }} />
        </View>
      </KeyboardStickyView>

      <CustomerPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={setCustomer} />
      <Sheet visible={confirmOpen} onClose={() => !sale.isPending && setConfirmOpen(false)} title="Confirm sale" testID="confirm-sale-sheet">
        <Card style={{ gap: 0 }}>
          <KV label="Product" value={product?.name ?? ""} testID="confirm-product" />
          <KV label="Warehouse" value={current?.name ?? ""} testID="confirm-warehouse" />
          <KV label="Quantity" value={`${fmtQty(qty)} ${product?.unit ?? ""}`} strong testID="confirm-quantity" />
          <KV label="Sold to" value={customer?.name ?? "—"} testID="confirm-customer" />
          <KV label="Available" value={fmtQty(available)} testID="confirm-available" />
          <KV label="Remaining" value={fmtQty(available - qty)} strong testID="confirm-remaining" />
          {priceNum != null ? <KV label="Total" value={fmtMoney(priceNum * qty)} testID="confirm-total" /> : null}
        </Card>
        {error ? <Banner tone="error" text={error} testID="confirm-sale-error" /> : null}
        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <Button title="Cancel" variant="outline" size="lg" style={{ flex: 1 }} disabled={sale.isPending} onPress={() => setConfirmOpen(false)} testID="cancel-sale-button" />
          <Button title="Confirm Sale" size="lg" style={{ flex: 1.4 }} loading={sale.isPending} onPress={() => idemKey && sale.mutate(idemKey)} testID="confirm-sale-button" />
        </View>
      </Sheet>
    </View>
  );
}
