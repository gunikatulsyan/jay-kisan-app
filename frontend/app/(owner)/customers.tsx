import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Customer } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { Column, InfiniteList, useDebounced, usePaged } from "@/src/components/DataList";
import { Icon } from "@/src/components/Icon";
import { CustomerPicker, ExportSheet } from "@/src/components/Pickers";
import { Badge, Field, IconButton, Txt } from "@/src/components/ui";
import { fmtDateTime } from "@/src/utils/format";
import { radius, spacing, useTheme } from "@/src/theme";

export default function Customers() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim());
  const [createOpen, setCreateOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const list = usePaged<Customer>("customers", "/customers", { q: dq, include_inactive: true, limit: 40 });
  const cols: Column<Customer>[] = [
    { key: "name", title: "Customer", flex: 2.5, render: (c) => <Txt v="bodyMedium">{c.name}</Txt> },
    { key: "phone", title: "Phone", flex: 1.3, render: (c) => <Txt v="body">{c.phone ?? "—"}</Txt> },
    { key: "addr", title: "Address", flex: 2, render: (c) => <Txt v="body" numberOfLines={1}>{c.address ?? "—"}</Txt> },
    { key: "tax", title: "PAN / VAT", flex: 1.3, render: (c) => <Txt v="body">{c.tax_id ?? "—"}</Txt> },
    { key: "created", title: "Created", flex: 1.3, render: (c) => <Txt v="caption">{fmtDateTime(c.created_at)}</Txt> },
    { key: "st", title: "Status", flex: 0.8, align: "right", render: (c) => <Badge label={c.active ? "ACTIVE" : "INACTIVE"} tone={c.active ? "success" : "neutral"} /> },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Customers" back right={<>
        <IconButton icon="download-outline" onPress={() => setExportOpen(true)} testID="customers-export-button" label="Export" />
        <IconButton icon="person-add-outline" onPress={() => setCreateOpen(true)} testID="add-customer-button" label="New customer" />
      </>}>
        <View style={{ padding: spacing.lg, paddingTop: spacing.sm }}>
          <Field placeholder="Search name or phone" value={q} onChangeText={setQ} testID="customers-search-input" right={<View style={{ paddingRight: spacing.md }}><Icon name="search" size={18} color={colors.muted} /></View>} />
        </View>
      </AppHeader>
      <InfiniteList query={list} columns={cols} testID="customers-list" bottomPad={insets.bottom} onPressItem={(c) => router.push(`/customer/${c.id}`)} emptyTitle="No customers" emptyIcon="people-outline"
        renderItem={(c) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }}>
            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" }}>
              <Txt v="bodyMedium" color={colors.brand}>{c.name.slice(0, 1).toUpperCase()}</Txt>
            </View>
            <View style={{ flex: 1 }}>
              <Txt v="bodyMedium">{c.name}</Txt>
              <Txt v="caption">{[c.phone, c.address].filter(Boolean).join(" · ") || "—"}</Txt>
            </View>
            {!c.active ? <Badge label="INACTIVE" /> : <Icon name="chevron-forward" size={16} color={colors.muted} />}
          </View>
        )} />
      <CustomerPicker visible={createOpen} onClose={() => setCreateOpen(false)} onSelect={(c) => router.push(`/customer/${c.id}`)} />
      <ExportSheet visible={exportOpen} onClose={() => setExportOpen(false)} report="customers" title="Export customers" />
    </View>
  );
}
