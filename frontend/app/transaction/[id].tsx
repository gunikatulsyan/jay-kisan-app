import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage, newIdempotencyKey } from "@/src/api/client";
import type { StockResult, Txn } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { AppHeader } from "@/src/components/AppHeader";
import { useToast } from "@/src/components/Toast";
import { TxnRow, TxnTypeBadge } from "@/src/components/TxnRow";
import { Banner, Button, Card, ErrorView, Field, KV, Loading, SectionTitle, Txt } from "@/src/components/ui";
import { fmtDateTime, fmtMoney, fmtQty } from "@/src/utils/format";
import { spacing, useTheme } from "@/src/theme";

type Detail = { transaction: Txn; corrections: Txn[]; related: Txn[]; effective_quantity: number | null; correctable: boolean };

export default function TransactionDetail() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["transaction", id], queryFn: () => api<Detail>(`/transactions/${id}`), enabled: !!me });
  const [corrected, setCorrected] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newIdempotencyKey());
  const correct = useMutation({
    mutationFn: () => api<StockResult>(`/transactions/${id}/corrections`, { method: "POST", idempotencyKey: key, body: { corrected_quantity: parseInt(corrected, 10), reason: reason.trim() } }),
    onSuccess: (r) => {
      toast.show({ title: "Correction recorded", message: `${r.transaction.txn_no} linked to the original transaction`, tone: "success" });
      setCorrected(""); setReason(""); setKey(newIdempotencyKey());
      ["transaction", "transactions", "product", "inventory", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: () => setKey(newIdempotencyKey()),
  });
  if (!me) return <Redirect href="/login" />;
  const isOwner = me.user.role === "owner";
  const d = q.data;
  const t = d?.transaction;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title={t ? t.txn_no : "Transaction"} subtitle="Transactions are permanent and cannot be edited" back />
      {q.isLoading ? <Loading /> : q.isError || !d || !t ? <ErrorView message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : (
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 820, width: "100%", alignSelf: "center" }}>
          <Card style={{ gap: 0 }} testID="transaction-detail-card">
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm }}>
              <TxnTypeBadge type={t.type} />
              <Txt v="caption">{fmtDateTime(t.created_at)}</Txt>
            </View>
            <KV label="Product" value={t.product_name} />
            <KV label="SKU" value={t.sku ?? "—"} />
            <KV label="Warehouse" value={t.warehouse_name ?? "—"} />
            <KV label="Quantity change" value={`${t.quantity_change > 0 ? "+" : ""}${fmtQty(t.quantity_change)} ${t.unit ?? ""}`} strong testID="txn-quantity-change" />
            <KV label="Previous → New" value={`${fmtQty(t.quantity_before)} → ${fmtQty(t.quantity_after)}`} testID="txn-before-after" />
            <KV label={t.type === "SALE" || t.type === "CORRECTION" ? "Employee / user" : "Performed by"} value={`${t.user_name ?? ""} (${t.user_role ?? ""})`} />
            {t.customer_name ? <KV label="Sold to" value={t.customer_name} testID="txn-customer" /> : null}
            {t.counterpart_warehouse_name ? <KV label={t.type === "TRANSFER_OUT" ? "Transferred to" : "Transferred from"} value={t.counterpart_warehouse_name} /> : null}
            {t.unit_price != null ? <KV label="Unit price" value={fmtMoney(t.unit_price)} /> : null}
            {t.total_amount != null ? <KV label="Total amount" value={fmtMoney(t.total_amount)} /> : null}
            {isOwner && t.unit_cost != null ? <KV label="Unit cost" value={fmtMoney(t.unit_cost)} /> : null}
            {isOwner && (t.type === "SALE" || t.original_type === "SALE") ? <KV label="Profit" value={t.profit != null ? fmtMoney(t.profit) : "Unavailable (price missing)"} /> : null}
            {t.reason_note ? <KV label="Reason" value={t.reason_note} testID="txn-reason" /> : null}
            {t.note ? <KV label="Note" value={t.note} /> : null}
            {t.corrects_txn_no ? <KV label="Corrects" value={t.corrects_txn_no} /> : null}
          </Card>

          {d.effective_quantity != null && d.corrections.length > 0 ? (
            <Banner tone="warning" text={`Corrected: effective quantity is now ${fmtQty(d.effective_quantity)} (original ${fmtQty(Math.abs(t.quantity_change))}).`} testID="effective-quantity-banner" />
          ) : null}

          {d.corrections.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <SectionTitle title="Linked corrections" />
              {d.corrections.map((c) => <TxnRow key={c.id} t={c} onPress={() => router.push(`/transaction/${c.id}`)} />)}
            </View>
          ) : null}
          {d.related.length > 0 ? (
            <View style={{ gap: spacing.sm }}>
              <SectionTitle title={t.transfer_id ? "Linked transfer" : "Original transaction"} />
              {d.related.map((c) => <TxnRow key={c.id} t={c} onPress={() => router.push(`/transaction/${c.id}`)} />)}
            </View>
          ) : null}

          {d.correctable ? (
            <Card style={{ gap: spacing.md }} testID="correction-form">
              <Txt v="subtitle">Correct this transaction</Txt>
              <Txt v="body" color={colors.muted}>The original record stays unchanged. A new linked correction transaction adjusts stock by the difference.</Txt>
              <Field label={`Correct total quantity (currently ${fmtQty(d.effective_quantity)})`} value={corrected} onChangeText={(v) => setCorrected(v.replace(/[^0-9]/g, ""))} keyboardType="number-pad" testID="correction-quantity-input" />
              <Field label="Reason for correction *" value={reason} onChangeText={setReason} placeholder="e.g. Actual quantity sold was 25" multiline testID="correction-reason-input" />
              {correct.isError ? <Banner tone="error" text={errorMessage(correct.error)} testID="correction-error" /> : null}
              <Button title="Record correction" icon="git-compare-outline" loading={correct.isPending} disabled={corrected === "" || reason.trim().length < 3} onPress={() => correct.mutate()} testID="submit-correction-button" />
            </Card>
          ) : null}
          {isOwner ? <Button title="Open product" variant="outline" icon="cube-outline" onPress={() => router.push(`/product/${t.product_id}`)} testID="open-product-button" /> : null}
        </KeyboardAwareScrollView>
      )}
    </View>
  );
}
