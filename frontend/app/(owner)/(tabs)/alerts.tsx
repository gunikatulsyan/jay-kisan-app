import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api } from "@/src/api/client";
import type { Notification } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { InfiniteList, usePaged } from "@/src/components/DataList";
import { Icon, IconName } from "@/src/components/Icon";
import { Button, Chip, ChipRow, Txt } from "@/src/components/ui";
import { usesNativeTabs } from "@/src/navigation";
import { useUnreadCount } from "@/src/realtime/RealtimeProvider";
import { fmtQty, fmtRelative } from "@/src/utils/format";
import { radius, spacing, useTheme } from "@/src/theme";

const ICON: Record<string, IconName> = { SALE: "cart", LOW_STOCK: "alert-circle", OUT_OF_STOCK: "close-circle" };

export default function Alerts() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const unread = useUnreadCount();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = usePaged<Notification>("notifications", "/notifications", { unread_only: unreadOnly || undefined, limit: 30 });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["unread"] }); };
  const markRead = useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: "POST" }), onSuccess: refresh });
  const markAll = useMutation({ mutationFn: () => api("/notifications/read-all", { method: "POST" }), onSuccess: refresh });

  const open = (n: Notification) => {
    if (!n.read) markRead.mutate(n.id);
    if (n.transaction_id) router.push(`/transaction/${n.transaction_id}`);
    else if (n.product_id) router.push(`/product/${n.product_id}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Notifications" subtitle={`${unread} unread`}
        right={<Button title="Mark all read" size="sm" variant="ghost" icon="checkmark-done" disabled={unread === 0} loading={markAll.isPending} onPress={() => markAll.mutate()} testID="mark-all-read-button" />}>
        <ChipRow>
          <Chip label="All" selected={!unreadOnly} onPress={() => setUnreadOnly(false)} testID="alerts-filter-all" />
          <Chip label={`Unread (${unread})`} selected={unreadOnly} onPress={() => setUnreadOnly(true)} testID="alerts-filter-unread" />
        </ChipRow>
      </AppHeader>
      <InfiniteList query={q} testID="notifications-list" bottomPad={usesNativeTabs ? insets.bottom : 0} emptyTitle="You're all caught up" emptyMessage="Employee sales and stock alerts will appear here in real time." emptyIcon="notifications-outline"
        renderItem={(n) => {
          const m = n.meta ?? {};
          const tone = n.type === "SALE" ? colors.brandPrimary : n.type === "OUT_OF_STOCK" ? colors.error : colors.warning;
          return (
            <View testID={`notification-${n.id}`} style={{ padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: n.read ? colors.border : colors.brandSecondary, backgroundColor: n.read ? colors.surfaceSecondary : colors.brandTertiary }}>
              <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "flex-start" }}>
                <Icon name={ICON[n.type] ?? "notifications"} size={22} color={tone} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Txt v="bodyMedium" style={{ flex: 1 }}>{n.title}</Txt>
                    {!n.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error }} testID={`unread-dot-${n.id}`} /> : null}
                    <Txt v="caption">{fmtRelative(n.created_at)}</Txt>
                  </View>
                  <Txt v="body">{n.message}</Txt>
                  {m.warehouse_name ? <Txt v="caption">Warehouse: {m.warehouse_name}</Txt> : null}
                  {m.sold_to ? <Txt v="caption">Sold to: {m.sold_to}</Txt> : null}
                  {m.previous != null ? <Txt v="caption">Stock: {fmtQty(m.previous)} → {fmtQty(m.new)}{m.txn_no ? ` · ${m.txn_no}` : ""}</Txt> : null}
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" }}>
                {!n.read ? <Button title="Mark as read" size="sm" variant="outline" onPress={() => markRead.mutate(n.id)} testID={`mark-read-${n.id}`} /> : null}
                {n.transaction_id || n.product_id ? <Button title={n.transaction_id ? "View / Edit" : "View product"} size="sm" variant="secondary" onPress={() => open(n)} testID={`open-notification-${n.id}`} /> : null}
              </View>
            </View>
          );
        }} />
    </View>
  );
}
