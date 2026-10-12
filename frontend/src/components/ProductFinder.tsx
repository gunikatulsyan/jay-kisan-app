import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";

import type { InventoryRow } from "@/src/api/types";
import { useDebounced, usePaged } from "@/src/components/DataList";
import { Icon } from "@/src/components/Icon";
import { Field, Loading, StatusBadge, Txt } from "@/src/components/ui";
import { fmtQty } from "@/src/utils/format";
import { radius, spacing, useTheme } from "@/src/theme";

// Speed-first product finder: huge scan button + indexed server search within the warehouse.
export function ProductFinder({ warehouseId, onPick, scanMode = "sell" }: { warehouseId: string | null; onPick: (productId: string) => void; scanMode?: "sell" | "lookup" }) {
  const { colors } = useTheme();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const res = usePaged<InventoryRow>("inventory", "/inventory", { warehouse_id: warehouseId, q: dq, limit: 20 }, !!warehouseId && dq.length > 0);
  const items = res.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <View style={{ gap: spacing.md }}>
      <Pressable testID="scan-barcode-button" onPress={() => router.push({ pathname: "/scan", params: { mode: scanMode } })} disabled={!warehouseId}
        style={({ pressed }) => ({ height: 140, borderRadius: radius.lg, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", gap: spacing.sm,
          opacity: !warehouseId ? 0.5 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
        <Icon name="barcode-outline" size={48} color={colors.onBrandPrimary} />
        <Txt v="title" color={colors.onBrandPrimary}>Scan barcode</Txt>
      </Pressable>
      <Field placeholder="Search product name, SKU or barcode" value={q} onChangeText={setQ} autoCorrect={false} testID="product-search-input" editable={!!warehouseId}
        right={<View style={{ paddingRight: spacing.md }}><Icon name="search" size={18} color={colors.muted} /></View>} />
      {dq.length > 0 ? (
        res.isLoading ? <Loading /> : items.length === 0 ? (
          <Txt v="body" color={colors.muted} style={{ textAlign: "center", padding: spacing.lg }} testID="product-search-empty">No products in stock match “{dq}”</Txt>
        ) : (
          <View style={{ gap: spacing.sm }}>
            {items.map((i) => (
              <Pressable key={i.id} testID={`product-result-${i.product_id}`} onPress={() => onPick(i.product_id)}
                style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, minHeight: 72, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.brandTertiary : colors.surfaceSecondary })}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="subtitle" numberOfLines={2}>{i.product_name}</Txt>
                  <Txt v="caption">{i.sku}{i.barcode ? ` · ${i.barcode}` : ""}</Txt>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Txt v="title" color={i.quantity > 0 ? colors.onSurface : colors.error}>{fmtQty(i.quantity)}</Txt>
                  <StatusBadge status={i.stock_status} />
                </View>
              </Pressable>
            ))}
            {res.hasNextPage ? <Pressable onPress={() => res.fetchNextPage()} style={{ padding: spacing.md, alignItems: "center" }}><Txt v="bodyMedium" color={colors.brandPrimary}>Show more</Txt></Pressable> : null}
          </View>
        )
      ) : null}
    </View>
  );
}
