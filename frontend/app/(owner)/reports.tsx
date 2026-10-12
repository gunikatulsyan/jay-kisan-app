import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage, qs } from "@/src/api/client";
import type { SalesRow } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { ExportSheet } from "@/src/components/Pickers";
import { Button, Card, Chip, ChipRow, ErrorView, Loading, SectionTitle, StatCard, Txt } from "@/src/components/ui";
import { WarehousePicker } from "@/src/components/WarehousePicker";
import { useWarehouse } from "@/src/context/WarehouseContext";
import { useIsWide } from "@/src/navigation";
import { fmtMoney, fmtQty, RangeKey, RANGES, rangeDates } from "@/src/utils/format";
import { spacing, useTheme } from "@/src/theme";

type Report = { group_by: string; rows: (SalesRow & { key: string; label: string })[]; totals: SalesRow };
const GROUPS = [{ key: "product", label: "Product" }, { key: "employee", label: "Employee" }, { key: "warehouse", label: "Warehouse" }, { key: "customer", label: "Customer" }, { key: "day", label: "Day" }];
const OTHER = [
  { report: "inventory", label: "Warehouse stock" }, { report: "low_stock", label: "Low / out of stock" }, { report: "transactions", label: "Stock movement (all transactions)" },
  { report: "transactions:TRANSFER_OUT,TRANSFER_IN", label: "Warehouse transfers" }, { report: "transactions:ADJUSTMENT", label: "Stock adjustments" },
  { report: "transactions:STOCK_REMOVAL", label: "Stock removals" }, { report: "products", label: "Product catalogue" }, { report: "customers", label: "Customers" }, { report: "audit", label: "Audit log" },
];

export default function Reports() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const { selected } = useWarehouse();
  const [group, setGroup] = useState("product");
  const [range, setRange] = useState<RangeKey>("30d");
  const [exp, setExp] = useState<{ report: string; params: Record<string, string | undefined>; title: string } | null>(null);
  const dates = rangeDates(range);
  const q = useQuery({ queryKey: ["sales", group, range, selected], queryFn: () => api<Report>(`/reports/sales${qs({ group_by: group, warehouse_id: selected, ...dates })}`) });
  const t = q.data?.totals;
  const openOther = (o: (typeof OTHER)[number]) => {
    const [report, type] = o.report.split(":");
    setExp({ report, params: { warehouse_id: selected, type, from: report === "transactions" || report === "audit" ? dates.from : undefined, to: report === "transactions" || report === "audit" ? dates.to : undefined }, title: o.label });
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Reports" subtitle="Sales, revenue & profit (NPR)" back>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}><WarehousePicker /></View>
        <ChipRow testID="report-range-chips">{RANGES.map((r) => <Chip key={r.key} label={r.label} selected={range === r.key} onPress={() => setRange(r.key)} testID={`report-range-${r.key}`} />)}</ChipRow>
        <ChipRow testID="report-group-chips">{GROUPS.map((g) => <Chip key={g.key} label={`By ${g.label.toLowerCase()}`} selected={group === g.key} onPress={() => setGroup(g.key)} testID={`report-group-${g.key}`} />)}</ChipRow>
      </AppHeader>
      <ScrollView refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />} contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl }}>
        {q.isLoading ? <Loading /> : q.isError || !q.data || !t ? <ErrorView message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : (
          <>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
              <StatCard label="Units sold" value={fmtQty(t.units)} icon="cart-outline" tone="brand" testID="report-units" sub={`${fmtQty(t.txns)} sales`} />
              <StatCard label="Revenue" value={t.revenue != null ? fmtMoney(t.revenue) : "Unavailable"} icon="cash-outline" tone="brand" testID="report-revenue" sub={t.unpriced_units ? `${fmtQty(t.unpriced_units)} units without sale price` : "All sales priced"} />
              <StatCard label="Cost" value={t.cost != null ? fmtMoney(t.cost) : "Unavailable"} icon="wallet-outline" testID="report-cost" />
              <StatCard label="Profit" value={t.profit != null ? fmtMoney(t.profit) : "Unavailable"} icon="trending-up-outline" tone="brand" testID="report-profit" sub={t.profit_unavailable_units ? `Unavailable for ${fmtQty(t.profit_unavailable_units)} units (missing price)` : undefined} />
            </View>
            <Card style={{ gap: spacing.sm, padding: 0, overflow: "hidden" }} testID="sales-report-table">
              <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.lg, paddingBottom: spacing.sm }}>
                <SectionTitle title={`Sales by ${group}`} />
                <View style={{ flex: 1 }} />
                <Button title="Export" size="sm" variant="outline" icon="download-outline" testID="export-sales-report" onPress={() => setExp({ report: "sales", params: { group_by: group, warehouse_id: selected, ...dates }, title: "Export sales report" })} />
              </View>
              <View style={{ flexDirection: "row", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.surfaceTertiary }}>
                <Txt v="label" style={{ flex: 2.5 }}>{group}</Txt>
                <Txt v="label" style={{ flex: 1, textAlign: "right" }}>Units</Txt>
                <Txt v="label" style={{ flex: 1.4, textAlign: "right" }}>Revenue</Txt>
                {wide ? <Txt v="label" style={{ flex: 1.4, textAlign: "right" }}>Cost</Txt> : null}
                <Txt v="label" style={{ flex: 1.4, textAlign: "right" }}>Profit</Txt>
              </View>
              {q.data.rows.length === 0 ? <Txt v="body" color={colors.muted} style={{ padding: spacing.lg }}>No sales in this period.</Txt> : q.data.rows.map((r) => (
                <View key={String(r.key)} style={{ flexDirection: "row", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                  <View style={{ flex: 2.5 }}>
                    <Txt v="bodyMedium" numberOfLines={1}>{r.label}</Txt>
                    {r.unpriced_units ? <Txt v="caption">{fmtQty(r.unpriced_units)} units unpriced</Txt> : null}
                  </View>
                  <Txt v="body" style={{ flex: 1, textAlign: "right" }}>{fmtQty(r.units)}</Txt>
                  <Txt v="body" style={{ flex: 1.4, textAlign: "right" }}>{fmtMoney(r.revenue)}</Txt>
                  {wide ? <Txt v="body" style={{ flex: 1.4, textAlign: "right" }}>{fmtMoney(r.cost)}</Txt> : null}
                  <Txt v="bodyMedium" style={{ flex: 1.4, textAlign: "right" }} color={r.profit != null && r.profit < 0 ? colors.error : colors.onSurface}>{r.profit != null ? fmtMoney(r.profit) : "N/A"}</Txt>
                </View>
              ))}
            </Card>
          </>
        )}
        <Card style={{ gap: spacing.sm }}>
          <SectionTitle title="Other reports & exports" />
          <Txt v="caption">CSV, Excel or PDF. Transaction-based exports use the selected date range and warehouse.</Txt>
          {OTHER.map((o) => <Button key={o.report} title={o.label} variant="outline" icon="document-text-outline" onPress={() => openOther(o)} testID={`export-${o.report.replace(/[:,]/g, "-").toLowerCase()}`} style={{ justifyContent: "flex-start" }} />)}
        </Card>
      </ScrollView>
      <ExportSheet visible={!!exp} onClose={() => setExp(null)} report={exp?.report ?? "sales"} params={exp?.params} title={exp?.title} />
    </View>
  );
}
