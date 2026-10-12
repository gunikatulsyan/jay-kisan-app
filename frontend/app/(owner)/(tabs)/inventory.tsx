import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { InventoryRow, Product } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { Column, InfiniteList, useDebounced, usePaged } from "@/src/components/DataList";
import { Icon } from "@/src/components/Icon";
import { CategoryPicker, ExportSheet } from "@/src/components/Pickers";
import { Chip, ChipRow, Field, IconButton, StatusBadge, Txt } from "@/src/components/ui";
import { WarehousePicker } from "@/src/components/WarehousePicker";
import { useWarehouse } from "@/src/context/WarehouseContext";
import { usesNativeTabs } from "@/src/navigation";
import { fmtMoney, fmtQty } from "@/src/utils/format";
import { radius, spacing, useTheme } from "@/src/theme";

const STATUS = [
  { key: "all", label: "All" }, { key: "low", label: "Low stock" }, { key: "out", label: "Out of stock" }, { key: "low,out", label: "Low + out" }, { key: "ok", label: "In stock" },
];

function RowCard({ title, sub, qty, status, unit }: { title: string; sub: string; qty?: number | null; status?: string | null; unit?: string | null }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }}>
      <View style={{ width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
        <Icon name="cube-outline" color={colors.brandPrimary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="bodyMedium" numberOfLines={2}>{title}</Txt>
        <Txt v="caption" numberOfLines={1}>{sub}</Txt>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <Txt v="subtitle">{fmtQty(qty)} <Txt v="caption">{unit ?? ""}</Txt></Txt>
        <StatusBadge status={status} />
      </View>
    </View>
  );
}

export default function Inventory() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ status?: string }>();
  const { selected, current } = useWarehouse();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const [status, setStatus] = useState(params.status ?? "all");
  const [cat, setCat] = useState<{ id: string | null; path: string }>({ id: null, path: "" });
  const [catOpen, setCatOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  useEffect(() => { if (params.status) setStatus(params.status); }, [params.status]);
  const useInv = selected !== "all" || status !== "all";
  const invQ = usePaged<InventoryRow>("inventory", "/inventory", { warehouse_id: selected, q: dq, status: status === "all" ? undefined : status, category_id: cat.id, limit: 40 }, useInv);
  const prodQ = usePaged<Product>("products", "/products", { q: dq, category_id: cat.id, limit: 40 }, !useInv);
  const bottomPad = usesNativeTabs ? insets.bottom : 0;

  const invCols: Column<InventoryRow>[] = [
    { key: "name", title: "Product", flex: 3, render: (i) => <View><Txt v="bodyMedium" numberOfLines={1}>{i.product_name}</Txt><Txt v="caption">{i.sku}</Txt></View> },
    { key: "wh", title: "Warehouse", flex: 1.5, render: (i) => <Txt v="body">{i.warehouse_name}</Txt> },
    { key: "qty", title: "Quantity", flex: 1, align: "right", render: (i) => <Txt v="bodyMedium">{fmtQty(i.quantity)} {i.unit}</Txt> },
    { key: "min", title: "Min", flex: 0.8, align: "right", render: (i) => <Txt v="body">{fmtQty(i.min_stock ?? i.product_min_stock)}</Txt> },
    { key: "price", title: "Cost / Sell", flex: 1.5, align: "right", render: (i) => <Txt v="caption">{fmtMoney(i.purchase_price)} / {fmtMoney(i.selling_price)}</Txt> },
    { key: "status", title: "Status", flex: 1.2, align: "right", render: (i) => <StatusBadge status={i.stock_status} /> },
  ];
  const prodCols: Column<Product>[] = [
    { key: "name", title: "Product", flex: 3, render: (p) => <View><Txt v="bodyMedium" numberOfLines={1}>{p.name}</Txt><Txt v="caption">{p.sku}{p.barcode ? ` · ${p.barcode}` : ""}</Txt></View> },
    { key: "brand", title: "Brand", flex: 1.2, render: (p) => <Txt v="body">{p.brand ?? "—"}</Txt> },
    { key: "qty", title: "Total stock", flex: 1, align: "right", render: (p) => <Txt v="bodyMedium">{fmtQty(p.stock_total)} {p.unit}</Txt> },
    { key: "price", title: "Cost / Sell", flex: 1.5, align: "right", render: (p) => <Txt v="caption">{fmtMoney(p.purchase_price)} / {fmtMoney(p.selling_price)}</Txt> },
    { key: "status", title: "Status", flex: 1.2, align: "right", render: (p) => p.active ? <StatusBadge status={p.stock_status} /> : <Txt v="caption">Inactive</Txt> },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Inventory" subtitle={current?.name ?? "All warehouses"}
        right={<>
          <IconButton icon="barcode-outline" onPress={() => router.push({ pathname: "/scan", params: { mode: "lookup" } })} testID="inventory-scan-button" label="Scan" />
          <IconButton icon="download-outline" onPress={() => setExportOpen(true)} testID="inventory-export-button" label="Export" />
          <IconButton icon="add-circle-outline" onPress={() => router.push("/product-form")} testID="inventory-add-product-button" label="New product" />
        </>}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm }}>
          <Field placeholder="Search name, SKU or barcode" value={q} onChangeText={setQ} autoCorrect={false} testID="inventory-search-input"
            right={<View style={{ paddingRight: spacing.md }}><Icon name="search" size={18} color={colors.muted} /></View>} />
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}>
            <WarehousePicker />
            <Chip label={cat.id ? cat.path.split(" › ").pop()! : "All categories"} icon="git-network-outline" selected={!!cat.id} onPress={() => setCatOpen(true)} testID="inventory-category-filter" />
          </View>
        </View>
        <ChipRow testID="inventory-status-chips">
          {STATUS.map((s) => <Chip key={s.key} label={s.label} selected={status === s.key} onPress={() => setStatus(s.key)} testID={`inventory-status-${s.key.replace(",", "-")}`} />)}
        </ChipRow>
      </AppHeader>
      {useInv ? (
        <InfiniteList key="inv" query={invQ} columns={invCols} testID="inventory-list" bottomPad={bottomPad} onPressItem={(i) => router.push(`/product/${i.product_id}`)}
          emptyTitle="No stock found" emptyMessage={dq ? `Nothing matches “${dq}”` : "Add stock to products in this warehouse."} emptyIcon="cube-outline"
          renderItem={(i) => <RowCard title={i.product_name} sub={`${i.sku} · ${i.warehouse_name}`} qty={i.quantity} status={i.stock_status} unit={i.unit} />} />
      ) : (
        <InfiniteList key="prod" query={prodQ} columns={prodCols} testID="products-list" bottomPad={bottomPad} onPressItem={(p) => router.push(`/product/${p.id}`)}
          emptyTitle="No products found" emptyMessage={dq ? `Nothing matches “${dq}”` : "Create your first product."} emptyIcon="cube-outline"
          renderItem={(p) => <RowCard title={p.name} sub={`${p.sku}${p.brand ? ` · ${p.brand}` : ""} · all warehouses`} qty={p.stock_total} status={p.stock_status} unit={p.unit} />} />
      )}
      <CategoryPicker visible={catOpen} onClose={() => setCatOpen(false)} selectedId={cat.id} onSelect={setCat} title="Filter by category" />
      <ExportSheet visible={exportOpen} onClose={() => setExportOpen(false)} report={status === "low,out" || status === "low" || status === "out" ? "low_stock" : "inventory"}
        params={{ warehouse_id: selected, status: status === "all" ? undefined : status, category_id: cat.id ?? undefined }} title="Export stock" />
    </View>
  );
}
