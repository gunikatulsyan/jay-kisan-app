import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Txn } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { Column, InfiniteList, usePaged } from "@/src/components/DataList";
import { ExportSheet } from "@/src/components/Pickers";
import { TxnRow, TxnTypeBadge } from "@/src/components/TxnRow";
import { Chip, ChipRow, IconButton, Txt } from "@/src/components/ui";
import { WarehousePicker } from "@/src/components/WarehousePicker";
import { useWarehouse } from "@/src/context/WarehouseContext";
import { fmtDateTime, fmtMoney, fmtQty, RangeKey, rangeDates } from "@/src/utils/format";
import { spacing, useTheme } from "@/src/theme";

const TYPES = [
  { key: "", label: "All" }, { key: "SALE", label: "Sales" }, { key: "STOCK_IN", label: "Stock in" }, { key: "STOCK_REMOVAL", label: "Removals" },
  { key: "ADJUSTMENT", label: "Adjustments" }, { key: "TRANSFER_OUT,TRANSFER_IN", label: "Transfers" }, { key: "CORRECTION", label: "Corrections" },
];
const RANGE: { key: RangeKey; label: string }[] = [{ key: "all", label: "Any time" }, { key: "today", label: "Today" }, { key: "7d", label: "7 days" }, { key: "30d", label: "30 days" }];

export default function Transactions() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ type?: string; product_id?: string; customer_id?: string }>();
  const { selected } = useWarehouse();
  const [type, setType] = useState(params.type ?? "");
  const [range, setRange] = useState<RangeKey>("all");
  const [exportOpen, setExportOpen] = useState(false);
  const filters = { warehouse_id: selected, type: type || undefined, product_id: params.product_id, customer_id: params.customer_id, ...rangeDates(range) };
  const q = usePaged<Txn>("transactions", "/transactions", { ...filters, limit: 40 });
  const cols: Column<Txn>[] = [
    { key: "date", title: "Date", flex: 1.3, render: (t) => <View><Txt v="body">{fmtDateTime(t.created_at)}</Txt><Txt v="caption">{t.txn_no}</Txt></View> },
    { key: "type", title: "Type", flex: 1.1, render: (t) => <TxnTypeBadge type={t.type} /> },
    { key: "product", title: "Product", flex: 2.2, render: (t) => <Txt v="bodyMedium" numberOfLines={1}>{t.product_name}</Txt> },
    { key: "wh", title: "Warehouse", flex: 1.3, render: (t) => <Txt v="body" numberOfLines={1}>{t.warehouse_name}</Txt> },
    { key: "chg", title: "Change", flex: 0.8, align: "right", render: (t) => <Txt v="bodyMedium" color={t.quantity_change > 0 ? colors.success : colors.error}>{t.quantity_change > 0 ? "+" : ""}{fmtQty(t.quantity_change)}</Txt> },
    { key: "ba", title: "Before → After", flex: 1.2, align: "right", render: (t) => <Txt v="caption">{fmtQty(t.quantity_before)} → {fmtQty(t.quantity_after)}</Txt> },
    { key: "who", title: "User / Customer", flex: 1.8, render: (t) => <View><Txt v="body" numberOfLines={1}>{t.user_name}</Txt><Txt v="caption" numberOfLines={1}>{t.customer_name ?? t.reason_note ?? ""}</Txt></View> },
    { key: "amt", title: "Amount", flex: 1, align: "right", render: (t) => <Txt v="body">{fmtMoney(t.total_amount)}</Txt> },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Transactions" subtitle="Immutable stock ledger" back
        right={<IconButton icon="download-outline" onPress={() => setExportOpen(true)} testID="transactions-export-button" label="Export" />}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}><WarehousePicker /></View>
        <ChipRow testID="transaction-type-chips">
          {TYPES.map((t) => <Chip key={t.key || "all"} label={t.label} selected={type === t.key} onPress={() => setType(t.key)} testID={`txn-type-${t.key ? t.key.split(",")[0].toLowerCase() : "all"}`} />)}
        </ChipRow>
        <ChipRow testID="transaction-range-chips">
          {RANGE.map((r) => <Chip key={r.key} label={r.label} selected={range === r.key} onPress={() => setRange(r.key)} testID={`txn-range-${r.key}`} />)}
        </ChipRow>
      </AppHeader>
      <InfiniteList query={q} columns={cols} testID="transactions-list" bottomPad={insets.bottom} onPressItem={(t) => router.push(`/transaction/${t.id}`)}
        emptyTitle="No transactions" emptyMessage="Try a different filter." emptyIcon="swap-horizontal-outline" renderItem={(t) => <TxnRow t={t} />} />
      <ExportSheet visible={exportOpen} onClose={() => setExportOpen(false)} report="transactions"
        params={{ warehouse_id: selected, type: type || undefined, product_id: params.product_id, customer_id: params.customer_id, from: filters.from, to: filters.to }} title="Export transactions" />
    </View>
  );
}
