import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage } from "@/src/api/client";
import type { Product } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { Icon } from "@/src/components/Icon";
import { CategoryPicker, useCategoryTree } from "@/src/components/Pickers";
import { useToast } from "@/src/components/Toast";
import { Banner, Button, Card, Chip, Field, Loading, Txt } from "@/src/components/ui";
import { useIsWide } from "@/src/navigation";
import { radius, spacing, useTheme } from "@/src/theme";

const UNITS = ["bag", "kg", "pack", "packet", "bottle", "litre", "pcs", "box"];
const EMPTY = { sku: "", name: "", category_id: null as string | null, brand: "", unit: "bag", barcode: "", supplier: "", purchase_price: "", selling_price: "", min_stock: "0", batch_no: "", expiry_date: "", description: "" };

export default function ProductForm() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const toast = useToast();
  const qc = useQueryClient();
  const { id, barcode } = useLocalSearchParams<{ id?: string; barcode?: string }>();
  const { tree } = useCategoryTree(true);
  const existing = useQuery({ queryKey: ["product", id], queryFn: () => api<Product>(`/products/${id}`), enabled: !!id });
  const [f, setF] = useState(id ? EMPTY : { ...EMPTY, barcode: barcode ?? "" });
  const [catOpen, setCatOpen] = useState(false);
  useEffect(() => {
    const p = existing.data;
    if (p) setF({ sku: p.sku, name: p.name, category_id: p.category_id ?? null, brand: p.brand ?? "", unit: p.unit, barcode: p.barcode ?? "", supplier: p.supplier ?? "",
      purchase_price: p.purchase_price != null ? String(p.purchase_price) : "", selling_price: p.selling_price != null ? String(p.selling_price) : "",
      min_stock: String(p.min_stock), batch_no: p.batch_no ?? "", expiry_date: p.expiry_date ?? "", description: p.description ?? "" });
  }, [existing.data]);
  const set = (k: keyof typeof EMPTY) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const priceErr = (v: string) => (v.trim() !== "" && (isNaN(Number(v)) || Number(v) < 0) ? "Enter a valid amount or leave empty" : null);
  const expiryErr = f.expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.expiry_date) ? "Use YYYY-MM-DD" : null;

  const save = useMutation({
    mutationFn: () => {
      const body = {
        sku: f.sku.trim(), name: f.name.trim(), category_id: f.category_id, brand: f.brand.trim() || null, unit: f.unit.trim() || "pcs",
        barcode: f.barcode.trim() || null, supplier: f.supplier.trim() || null, purchase_price: num(f.purchase_price), selling_price: num(f.selling_price),
        min_stock: parseInt(f.min_stock || "0", 10), batch_no: f.batch_no.trim() || null, expiry_date: f.expiry_date || null, description: f.description.trim() || null,
      };
      return id ? api<Product>(`/products/${id}`, { method: "PATCH", body }) : api<Product>("/products", { method: "POST", body });
    },
    onSuccess: (p) => {
      ["product", "products", "inventory", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.show({ title: id ? "Product updated" : "Product created", message: p.name, tone: "success" });
      if (id) router.back();
      else router.replace(`/product/${p.id}`);
    },
  });
  const valid = f.sku.trim() && f.name.trim() && !priceErr(f.purchase_price) && !priceErr(f.selling_price) && !expiryErr;
  const catPath = f.category_id ? tree.find((c) => c.id === f.category_id)?.path : null;
  const row = { flexDirection: (wide ? "row" : "column") as "row" | "column", gap: spacing.md };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title={id ? "Edit product" : "New product"} back />
      {id && existing.isLoading ? <Loading /> : (
        <KeyboardAwareScrollView bottomOffset={96} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: 110 + insets.bottom, maxWidth: 820, width: "100%", alignSelf: "center" }}>
          <Card style={{ gap: spacing.md }}>
            <Txt v="subtitle">Basics</Txt>
            <View style={row}>
              <Field style={{ flex: 1 }} label="SKU * (unique)" value={f.sku} onChangeText={set("sku")} autoCapitalize="characters" testID="product-sku-input" />
              <Field style={{ flex: 1 }} label="Barcode" value={f.barcode} onChangeText={set("barcode")} testID="product-barcode-input" />
            </View>
            <Field label="Product name *" value={f.name} onChangeText={set("name")} testID="product-name-input" />
            <View style={{ gap: spacing.xs }}>
              <Txt v="bodyMedium" color={colors.onSurfaceSecondary}>Category</Txt>
              <Pressable onPress={() => setCatOpen(true)} testID="product-category-button" style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, gap: spacing.sm }}>
                <Icon name="git-network-outline" size={18} color={colors.muted} />
                <Txt v="body" style={{ flex: 1 }} color={catPath ? colors.onSurface : colors.muted}>{catPath ?? "Select category"}</Txt>
                <Icon name="chevron-down" size={16} color={colors.muted} />
              </Pressable>
            </View>
            <View style={row}>
              <Field style={{ flex: 1 }} label="Brand" value={f.brand} onChangeText={set("brand")} testID="product-brand-input" />
              <Field style={{ flex: 1 }} label="Supplier" value={f.supplier} onChangeText={set("supplier")} testID="product-supplier-input" />
            </View>
            <Field label="Unit" value={f.unit} onChangeText={set("unit")} testID="product-unit-input" />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {UNITS.map((u) => <Chip key={u} label={u} selected={f.unit === u} onPress={() => set("unit")(u)} testID={`unit-chip-${u}`} />)}
            </View>
          </Card>
          <Card style={{ gap: spacing.md }}>
            <Txt v="subtitle">Pricing (optional, NPR)</Txt>
            <Txt v="caption">Leave empty if unknown — missing prices are never treated as zero.</Txt>
            <View style={row}>
              <Field style={{ flex: 1 }} label="Purchase / cost price" value={f.purchase_price} onChangeText={(v) => set("purchase_price")(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" error={priceErr(f.purchase_price)} testID="product-purchase-price-input" />
              <Field style={{ flex: 1 }} label="Selling price" value={f.selling_price} onChangeText={(v) => set("selling_price")(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" error={priceErr(f.selling_price)} testID="product-selling-price-input" />
            </View>
          </Card>
          <Card style={{ gap: spacing.md }}>
            <Txt v="subtitle">Stock control</Txt>
            <View style={row}>
              <Field style={{ flex: 1 }} label="Minimum stock (low-stock alert)" value={f.min_stock} onChangeText={(v) => set("min_stock")(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" testID="product-min-stock-input" />
              <Field style={{ flex: 1 }} label="Batch number" value={f.batch_no} onChangeText={set("batch_no")} testID="product-batch-input" />
              <Field style={{ flex: 1 }} label="Expiry date" value={f.expiry_date} onChangeText={set("expiry_date")} placeholder="YYYY-MM-DD" error={expiryErr} testID="product-expiry-input" />
            </View>
            <Field label="Description" value={f.description} onChangeText={set("description")} multiline testID="product-description-input" />
          </Card>
          {save.isError ? <Banner tone="error" text={errorMessage(save.error)} testID="product-form-error" /> : null}
        </KeyboardAwareScrollView>
      )}
      <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }} style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}>
        <View style={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.md, backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border }}>
          <Button title={id ? "Save changes" : "Create product"} size="lg" icon="checkmark" disabled={!valid} loading={save.isPending} onPress={() => save.mutate()} testID="save-product-button" style={{ maxWidth: 820, width: "100%", alignSelf: "center" }} />
        </View>
      </KeyboardStickyView>
      <CategoryPicker visible={catOpen} onClose={() => setCatOpen(false)} selectedId={f.category_id} onSelect={(c) => setF((s) => ({ ...s, category_id: c.id }))} />
    </View>
  );
}
