import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, ApiError, errorMessage, newIdempotencyKey } from "@/src/api/client";
import type { Product, StockResult } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { useToast } from "@/src/components/Toast";
import { Banner, Button, Card, Checkbox, Chip, ErrorView, Field, KV, Loading, Txt } from "@/src/components/ui";
import { WarehousePicker } from "@/src/components/WarehousePicker";
import { ADJUST_REASONS, fmtQty, REMOVAL_REASONS } from "@/src/utils/format";
import { spacing, useTheme } from "@/src/theme";

const TITLES: Record<string, string> = { in: "Add stock", remove: "Delete / Remove stock", adjust: "Stock adjustment", transfer: "Transfer stock" };

export default function StockAction() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ type: string; product_id: string; warehouse_id?: string }>();
  const type = params.type ?? "in";
  const q = useQuery({ queryKey: ["product", params.product_id], queryFn: () => api<Product>(`/products/${params.product_id}`) });
  const [wid, setWid] = useState(params.warehouse_id ?? "");
  const [toWid, setToWid] = useState("");
  const [qty, setQty] = useState("");
  const [physical, setPhysical] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey());
  useEffect(() => setKey(newIdempotencyKey()), [wid, toWid, qty, physical, unitCost, reason, note, confirm]);

  const p = q.data;
  const current = p?.inventory?.find((i) => i.warehouse_id === wid)?.quantity ?? 0;
  const n = parseInt(qty || "0", 10) || 0;
  const phys = physical === "" ? null : parseInt(physical, 10);
  const delta = phys == null ? 0 : phys - current;

  const submit = useMutation({
    mutationFn: () => {
      const base = { product_id: params.product_id };
      if (type === "in") return api<StockResult>("/stock/in", { method: "POST", idempotencyKey: key, body: { ...base, warehouse_id: wid, quantity: n, unit_cost: unitCost ? Number(unitCost) : null, note: note || null } });
      if (type === "remove") return api<StockResult>("/stock/remove", { method: "POST", idempotencyKey: key, body: { ...base, warehouse_id: wid, quantity: n, reason_code: reason, reason_note: note || null, confirm } });
      if (type === "adjust") return api<StockResult>("/stock/adjust", { method: "POST", idempotencyKey: key, body: { ...base, warehouse_id: wid, expected_quantity: current, physical_quantity: phys, reason_code: reason, reason_note: note || null } });
      return api<StockResult>("/stock/transfer", { method: "POST", idempotencyKey: key, body: { ...base, from_warehouse_id: wid, to_warehouse_id: toWid, quantity: n, note: note || null } });
    },
    onSuccess: (r) => {
      ["product", "products", "inventory", "dashboard", "transactions"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.show({ title: `${TITLES[type]} recorded`, message: `${r.transaction.txn_no} · ${fmtQty(r.transaction.quantity_before)} → ${fmtQty(r.transaction.quantity_after)}`, tone: "success" });
      router.back();
    },
    onError: (e) => { if (e instanceof ApiError && (e.code === "STOCK_CHANGED" || e.code === "INSUFFICIENT_STOCK")) q.refetch(); },
  });

  const reasons = type === "remove" ? REMOVAL_REASONS : ADJUST_REASONS;
  const needsNote = reason === "OTHER";
  let valid = !!wid;
  if (type === "in") valid = valid && n > 0;
  if (type === "remove") valid = valid && n > 0 && n <= current && !!reason && confirm && (!needsNote || note.trim().length >= 3);
  if (type === "adjust") valid = valid && phys != null && delta !== 0 && !!reason && (!needsNote || note.trim().length >= 3);
  if (type === "transfer") valid = valid && !!toWid && toWid !== wid && n > 0 && n <= current;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title={TITLES[type] ?? "Stock"} subtitle={p?.name} back />
      {q.isLoading ? <Loading /> : q.isError || !p ? <ErrorView message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : (
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 640, width: "100%", alignSelf: "center" }}>
          <Card style={{ gap: spacing.md }}>
            <KV label="Product" value={p.name} testID="stock-action-product" />
            <WarehousePicker value={wid} onChange={setWid} allowAll={false} label={type === "transfer" ? "From warehouse" : "Warehouse"} testID="stock-action-warehouse" />
            {type === "transfer" ? <WarehousePicker value={toWid} onChange={setToWid} allowAll={false} label="To warehouse" exclude={wid} testID="stock-action-to-warehouse" /> : null}
            {wid ? <KV label="Current system quantity" value={`${fmtQty(current)} ${p.unit}`} strong testID="stock-action-current" /> : null}
          </Card>

          <Card style={{ gap: spacing.md }}>
            {type === "adjust" ? (
              <>
                <Field label="Physical quantity counted *" value={physical} onChangeText={(v) => setPhysical(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" testID="adjust-physical-input" />
                {phys != null ? <Banner tone={delta === 0 ? "neutral" : "warning"} text={delta === 0 ? "Matches the system — no adjustment needed." : `Adjustment: ${delta > 0 ? "+" : ""}${fmtQty(delta)} ${p.unit}`} testID="adjust-delta" /> : null}
              </>
            ) : (
              <Field label="Quantity *" value={qty} onChangeText={(v) => setQty(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" testID="stock-action-quantity-input"
                error={(type === "remove" || type === "transfer") && n > current ? `Only ${fmtQty(current)} available` : null} />
            )}
            {type === "in" ? <Field label="Unit cost (optional, Rs.)" value={unitCost} onChangeText={(v) => setUnitCost(v.replace(/[^0-9.]/g, ""))} keyboardType="decimal-pad" hint="Defaults to the product purchase price" testID="stock-in-cost-input" /> : null}
            {type === "remove" || type === "adjust" ? (
              <View style={{ gap: spacing.sm }}>
                <Txt v="bodyMedium" color={colors.onSurfaceSecondary}>Reason * (required)</Txt>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {reasons.map((r) => <Chip key={r.code} label={r.label} selected={reason === r.code} onPress={() => setReason(r.code)} testID={`reason-${r.code}`} />)}
                </View>
              </View>
            ) : null}
            <Field label={needsNote ? "Explanation * (required for Other)" : "Note (optional)"} value={note} onChangeText={setNote} multiline testID="stock-action-note-input"
              error={needsNote && note.trim().length > 0 && note.trim().length < 3 ? "Please explain the reason" : null} />
            {type === "remove" ? <Checkbox checked={confirm} onToggle={() => setConfirm(!confirm)} label="I confirm this stock removal" testID="confirm-removal-checkbox" /> : null}
          </Card>
          {submit.isError ? <Banner tone="error" text={errorMessage(submit.error)} testID="stock-action-error" /> : null}
          <View style={{ flexDirection: "row", gap: spacing.md }}>
            <Button title="Cancel" variant="outline" size="lg" style={{ flex: 1 }} onPress={() => router.back()} testID="stock-action-cancel" />
            <Button title={type === "remove" ? "Remove Stock" : type === "in" ? "Add Stock" : type === "adjust" ? "Record adjustment" : "Transfer"} size="lg" style={{ flex: 1.4 }}
              variant={type === "remove" ? "danger" : "primary"} disabled={!valid} loading={submit.isPending} onPress={() => submit.mutate()} testID="stock-action-submit" />
          </View>
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}
