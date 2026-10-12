import { Pressable, View } from "react-native";

import type { Txn } from "@/src/api/types";
import { Icon, IconName } from "@/src/components/Icon";
import { Badge, Txt } from "@/src/components/ui";
import { fmtMoney, fmtQty, fmtRelative, TXN_LABELS } from "@/src/utils/format";
import { radius, spacing, useTheme } from "@/src/theme";

const ICONS: Record<string, IconName> = {
  SALE: "cart-outline", STOCK_IN: "arrow-down-circle-outline", STOCK_REMOVAL: "trash-outline", ADJUSTMENT: "construct-outline",
  TRANSFER_OUT: "arrow-forward-circle-outline", TRANSFER_IN: "arrow-back-circle-outline", CORRECTION: "git-compare-outline",
};

export function TxnTypeBadge({ type }: { type: string }) {
  const tone = type === "SALE" ? "brand" : type === "STOCK_IN" || type === "TRANSFER_IN" ? "success" : type === "STOCK_REMOVAL" ? "error" : type === "CORRECTION" ? "warning" : "neutral";
  return <Badge label={(TXN_LABELS[type] ?? type).toUpperCase()} tone={tone as any} />;
}

export function TxnRow({ t, onPress, showCost = true }: { t: Txn; onPress?: () => void; showCost?: boolean }) {
  const { colors } = useTheme();
  const positive = t.quantity_change > 0;
  return (
    <Pressable onPress={onPress} testID={`txn-row-${t.id}`}
      style={({ pressed }) => ({ flexDirection: "row", gap: spacing.md, padding: spacing.md, backgroundColor: pressed ? colors.brandTertiary : colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border })}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }}>
        <Icon name={ICONS[t.type] ?? "ellipse-outline"} size={20} color={colors.onSurfaceSecondary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Txt v="bodyMedium" numberOfLines={1} style={{ flex: 1 }}>{t.product_name}</Txt>
          <Txt v="subtitle" color={positive ? colors.success : colors.error}>{positive ? "+" : ""}{fmtQty(t.quantity_change)}</Txt>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
          <TxnTypeBadge type={t.type} />
          <Txt v="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
            {t.warehouse_name}{t.customer_name ? ` · ${t.customer_name}` : ""}{t.counterpart_warehouse_name ? ` · ${t.type === "TRANSFER_OUT" ? "to" : "from"} ${t.counterpart_warehouse_name}` : ""}
          </Txt>
        </View>
        <Txt v="caption">
          {t.user_name} · {fmtRelative(t.created_at)} · {fmtQty(t.quantity_before)} → {fmtQty(t.quantity_after)}
          {showCost && t.total_amount != null ? ` · ${fmtMoney(t.total_amount)}` : ""}
        </Txt>
      </View>
    </Pressable>
  );
}
