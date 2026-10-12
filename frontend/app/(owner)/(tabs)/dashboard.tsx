import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ReactNode, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage, qs } from "@/src/api/client";
import type { InventoryRow, SalesRow, Txn } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { CategoryPicker } from "@/src/components/Pickers";
import { TxnRow } from "@/src/components/TxnRow";
import { Button, Card, Chip, ChipRow, Empty, ErrorView, IconButton, Loading, SectionTitle, StatCard, StatusBadge, Txt } from "@/src/components/ui";
import { WarehousePicker } from "@/src/components/WarehousePicker";
import { useWarehouse } from "@/src/context/WarehouseContext";
import { useIsWide, usesNativeTabs } from "@/src/navigation";
import { useUnreadCount } from "@/src/realtime/RealtimeProvider";
import { fmtMoney, fmtQty, fmtRelative, RangeKey, RANGES, rangeDates } from "@/src/utils/format";
import { radius, spacing, useTheme } from "@/src/theme";

type Dash = {
  total_products: number; total_stock: number; inventory_value: number | null; unpriced_stock_rows: number;
  low_stock_count: number; out_of_stock_count: number; today: SalesRow; period: SalesRow & { from: string; to: string };
  warehouse_summary: { warehouse_id: string; name: string; code: string; quantity: number; low: number; out: number; value: number }[];
  top_products: (SalesRow & { product_id: string; name: string; unit?: string })[];
  recent_sales: Txn[]; recent_activity: Txn[]; slow_moving: InventoryRow[]; low_stock_items: InventoryRow[];
};

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <Card style={{ gap: spacing.sm }}><SectionTitle title={title} action={action} />{children}</Card>;
}

export default function Dashboard() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const wide = useIsWide();
  const unread = useUnreadCount();
  const { selected, current } = useWarehouse();
  const [range, setRange] = useState<RangeKey>("today");
  const [cat, setCat] = useState<{ id: string | null; path: string }>({ id: null, path: "" });
  const [catOpen, setCatOpen] = useState(false);
  const q = useQuery({
    queryKey: ["dashboard", selected, range, cat.id],
    queryFn: () => api<Dash>(`/reports/dashboard${qs({ warehouse_id: selected, category_id: cat.id, ...rangeDates(range) })}`),
  });
  const d = q.data;
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const unpricedNote = (r: SalesRow, kind: "revenue" | "profit") => {
    const n = kind === "revenue" ? r.unpriced_units : r.profit_unavailable_units;
    return n > 0 ? `${fmtQty(n)} units without ${kind === "revenue" ? "sale price" : "price data"}` : undefined;
  };
  const periodLabel = RANGES.find((r) => r.key === range)?.label ?? "Today";

  const left = d ? (
    <>
      <Section title="Low & out of stock" action={<Pressable onPress={() => router.push({ pathname: "/inventory", params: { status: "low,out" } })} testID="view-low-stock"><Txt v="bodyMedium" color={colors.brandPrimary}>View all</Txt></Pressable>}>
        {d.low_stock_items.length === 0 ? <Txt v="body" color={colors.muted}>All stock above minimum levels.</Txt> : d.low_stock_items.map((i) => (
          <Pressable key={i.id} onPress={() => router.push(`/product/${i.product_id}`)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }} testID={`low-item-${i.id}`}>
            <View style={{ flex: 1 }}>
              <Txt v="bodyMedium" numberOfLines={1}>{i.product_name}</Txt>
              <Txt v="caption">{i.warehouse_name} · min {fmtQty(i.min_stock ?? i.product_min_stock)}</Txt>
            </View>
            <Txt v="subtitle" color={i.stock_status === "out" ? colors.error : colors.warning}>{fmtQty(i.quantity)}</Txt>
            <StatusBadge status={i.stock_status} />
          </Pressable>
        ))}
      </Section>
      <Section title="Recent employee deductions" action={<Pressable onPress={() => router.push({ pathname: "/transactions", params: { type: "SALE" } })} testID="view-recent-sales"><Txt v="bodyMedium" color={colors.brandPrimary}>View all</Txt></Pressable>}>
        {d.recent_sales.length === 0 ? <Txt v="body" color={colors.muted}>No sales yet.</Txt> : d.recent_sales.map((t) => <TxnRow key={t.id} t={t} onPress={() => router.push(`/transaction/${t.id}`)} />)}
      </Section>
    </>
  ) : null;

  const right = d ? (
    <>
      <Section title="Warehouse summary">
        {d.warehouse_summary.map((w) => (
          <View key={w.warehouse_id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
            <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
              <Txt v="caption" color={colors.brand}>{w.code}</Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt v="bodyMedium">{w.name}</Txt>
              <Txt v="caption">{w.low} low · {w.out} out · {fmtMoney(w.value)}</Txt>
            </View>
            <Txt v="subtitle">{fmtQty(w.quantity)}</Txt>
          </View>
        ))}
      </Section>
      <Section title={`Top selling (${range === "today" ? "30 days" : periodLabel})`}>
        {d.top_products.length === 0 ? <Txt v="body" color={colors.muted}>No sales in this period.</Txt> : d.top_products.map((p) => {
          const max = d.top_products[0].units || 1;
          return (
            <View key={p.product_id} style={{ gap: 4, paddingVertical: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Txt v="bodyMedium" numberOfLines={1} style={{ flex: 1 }}>{p.name}</Txt>
                <Txt v="bodyMedium">{fmtQty(p.units)} {p.unit}</Txt>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary }}>
                <View style={{ height: 6, borderRadius: 3, width: `${Math.max(4, (p.units / max) * 100)}%`, backgroundColor: colors.brandPrimary }} />
              </View>
            </View>
          );
        })}
      </Section>
      <Section title="Slow moving (in stock, oldest sale)">
        {d.slow_moving.length === 0 ? <Txt v="body" color={colors.muted}>Nothing to show.</Txt> : d.slow_moving.map((i) => (
          <Pressable key={i.id} onPress={() => router.push(`/product/${i.product_id}`)} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.xs }}>
            <View style={{ flex: 1 }}>
              <Txt v="bodyMedium" numberOfLines={1}>{i.product_name}</Txt>
              <Txt v="caption">{i.warehouse_name} · last sale {i.last_sale_at ? fmtRelative(i.last_sale_at) : "never"}</Txt>
            </View>
            <Txt v="bodyMedium">{fmtQty(i.quantity)}</Txt>
          </Pressable>
        ))}
      </Section>
      <Section title="Recent activity">
        {d.recent_activity.map((t) => <TxnRow key={t.id} t={t} onPress={() => router.push(`/transaction/${t.id}`)} />)}
      </Section>
    </>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Dashboard" subtitle={`Jay Kisan · ${current?.name ?? "All warehouses"}`}
        right={<>
          <IconButton icon="barcode-outline" onPress={() => router.push({ pathname: "/scan", params: { mode: "lookup" } })} testID="dashboard-scan-button" label="Scan" />
          {!wide ? <IconButton icon="notifications-outline" badge={unread} onPress={() => router.push("/alerts")} testID="dashboard-notifications-button" label="Notifications" /> : null}
        </>}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexWrap: "wrap" }}>
          <WarehousePicker />
          <Chip label={cat.id ? cat.path.split(" › ").pop()! : "All categories"} icon="git-network-outline" selected={!!cat.id} onPress={() => setCatOpen(true)} testID="dashboard-category-filter" />
        </View>
        <ChipRow testID="dashboard-range-chips">
          {RANGES.map((r) => <Chip key={r.key} label={r.label} selected={range === r.key} onPress={() => setRange(r.key)} testID={`dashboard-range-${r.key}`} />)}
        </ChipRow>
      </AppHeader>
      <ScrollView refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} tintColor={colors.brandPrimary} />}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: bottomChrome + spacing.lg }}>
        {q.isLoading ? <Loading label="Loading dashboard…" /> : q.isError || !d ? <ErrorView message={errorMessage(q.error)} onRetry={() => q.refetch()} /> : (
          <>
            {d.total_products === 0 ? (
              <Empty icon="cube-outline" title="Add your first product" message="Create products, then add stock to a warehouse." action={<Button title="New product" icon="add" onPress={() => router.push("/product-form")} testID="empty-add-product" />} />
            ) : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }} testID="kpi-grid">
              <StatCard label="Total products" value={fmtQty(d.total_products)} icon="cube-outline" tone="brand" testID="kpi-total-products" />
              <StatCard label="Total stock (units)" value={fmtQty(d.total_stock)} icon="layers-outline" tone="brand" testID="kpi-total-stock" />
              <StatCard label="Inventory value (cost)" value={fmtMoney(d.inventory_value)} icon="wallet-outline" tone="brand" testID="kpi-inventory-value"
                sub={d.unpriced_stock_rows > 0 ? `${fmtQty(d.unpriced_stock_rows)} stocked items have no cost price` : undefined} />
              <StatCard label={`${periodLabel} · units sold`} value={fmtQty(d.period.units)} icon="cart-outline" testID="kpi-units-sold" sub={`${fmtQty(d.period.txns)} sales`} />
              <StatCard label={`${periodLabel} · revenue`} value={d.period.revenue != null ? fmtMoney(d.period.revenue) : "Unavailable"} icon="cash-outline" testID="kpi-revenue" sub={unpricedNote(d.period, "revenue")} />
              <StatCard label={`${periodLabel} · profit`} value={d.period.profit != null ? fmtMoney(d.period.profit) : "Unavailable"} icon="trending-up-outline" testID="kpi-profit" sub={unpricedNote(d.period, "profit")} />
              <StatCard label="Low stock" value={fmtQty(d.low_stock_count)} icon="alert-circle-outline" tone="warning" testID="kpi-low-stock" onPress={() => router.push({ pathname: "/inventory", params: { status: "low" } })} />
              <StatCard label="Out of stock" value={fmtQty(d.out_of_stock_count)} icon="close-circle-outline" tone="error" testID="kpi-out-of-stock" onPress={() => router.push({ pathname: "/inventory", params: { status: "out" } })} />
            </View>
            {range !== "today" ? (
              <Card style={{ flexDirection: "row", gap: spacing.lg, flexWrap: "wrap" }} testID="today-summary">
                <Txt v="bodyMedium">Today: {fmtQty(d.today.units)} units</Txt>
                <Txt v="bodyMedium">Revenue {d.today.revenue != null ? fmtMoney(d.today.revenue) : "—"}</Txt>
                <Txt v="bodyMedium">Profit {d.today.profit != null ? fmtMoney(d.today.profit) : "—"}</Txt>
              </Card>
            ) : null}
            <View style={{ flexDirection: "row", gap: spacing.md, flexWrap: "wrap" }}>
              <Button title="Sell / Deduct" icon="cart-outline" onPress={() => router.push("/sell")} testID="quick-sell" style={{ flexGrow: 1 }} />
              <Button title="New product" icon="add" variant="secondary" onPress={() => router.push("/product-form")} testID="quick-new-product" style={{ flexGrow: 1 }} />
              <Button title="Reports" icon="bar-chart-outline" variant="outline" onPress={() => router.push("/reports")} testID="quick-reports" style={{ flexGrow: 1 }} />
            </View>
            {wide ? (
              <View style={{ flexDirection: "row", gap: spacing.lg, alignItems: "flex-start" }}>
                <View style={{ flex: 1, gap: spacing.lg }}>{left}</View>
                <View style={{ flex: 1, gap: spacing.lg }}>{right}</View>
              </View>
            ) : <>{left}{right}</>}
          </>
        )}
      </ScrollView>
      <CategoryPicker visible={catOpen} onClose={() => setCatOpen(false)} selectedId={cat.id} onSelect={setCat} title="Filter by category" />
    </View>
  );
}
