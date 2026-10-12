import { useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AuditEntry } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { InfiniteList, usePaged } from "@/src/components/DataList";
import { ExportSheet } from "@/src/components/Pickers";
import { Badge, Chip, ChipRow, IconButton, Txt } from "@/src/components/ui";
import { fmtDateTime, RangeKey, rangeDates } from "@/src/utils/format";
import { radius, spacing, useTheme } from "@/src/theme";

const GROUPS = [
  { key: "", label: "All" },
  { key: "STOCK_ADDITION,STOCK_DEDUCTION,STOCK_REMOVAL,STOCK_ADJUSTMENT,STOCK_TRANSFER,TRANSACTION_CORRECTION,THRESHOLD_CHANGE,BULK_IMPORT", label: "Stock" },
  { key: "PRODUCT_CREATE,PRODUCT_UPDATE,PRODUCT_DEACTIVATE,PRODUCT_ACTIVATE,CATEGORY_CREATE,CATEGORY_RENAME,CATEGORY_MOVE,CATEGORY_DEACTIVATE", label: "Products" },
  { key: "EMPLOYEE_CREATE,EMPLOYEE_UPDATE,PERMISSION_CHANGE,PASSWORD_RESET_BY_OWNER,RESET_CODE_ISSUED,OWNER_CREATE,WAREHOUSE_CREATE,WAREHOUSE_UPDATE,WAREHOUSE_DEACTIVATE,SETTINGS_CHANGE", label: "Admin" },
  { key: "LOGIN_SUCCESS,LOGIN_FAILED,LOGOUT,LOGOUT_ALL_DEVICES,PASSWORD_CHANGED,PASSWORD_RESET_WITH_CODE,REFRESH_TOKEN_REUSE", label: "Security" },
  { key: "CUSTOMER_CREATE,CUSTOMER_UPDATE", label: "Customers" },
  { key: "DATA_EXPORT", label: "Exports" },
];
const RANGE: { key: RangeKey; label: string }[] = [{ key: "all", label: "Any time" }, { key: "today", label: "Today" }, { key: "7d", label: "7 days" }, { key: "30d", label: "30 days" }];

function Row({ a }: { a: AuditEntry }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const bad = a.action.includes("FAILED") || a.action.includes("REUSE") || a.action.includes("REMOVAL");
  return (
    <Pressable onPress={() => setOpen(!open)} testID={`audit-row-${a.id}`} style={{ padding: spacing.md, gap: 4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <Badge label={a.action.replace(/_/g, " ")} tone={bad ? "error" : a.action.startsWith("LOGIN") ? "neutral" : "brand"} />
        <View style={{ flex: 1 }} />
        <Txt v="caption">{fmtDateTime(a.created_at)}</Txt>
      </View>
      <Txt v="bodyMedium">{a.user_name ?? "System"} <Txt v="caption">{a.role ?? ""}</Txt></Txt>
      <Txt v="caption">{a.entity_type ?? ""}{a.meta?.txn_no ? ` · ${a.meta.txn_no}` : ""}{a.meta?.username ? ` · ${a.meta.username}` : ""}{a.ip ? ` · IP ${a.ip}` : ""}</Txt>
      {a.reason ? <Txt v="body">Reason: {a.reason}</Txt> : null}
      {open ? (
        <View style={{ gap: 4, marginTop: spacing.xs, padding: spacing.sm, backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm }}>
          <Txt v="caption" selectable>Before: {a.before ? JSON.stringify(a.before) : "—"}</Txt>
          <Txt v="caption" selectable>After: {a.after ? JSON.stringify(a.after) : "—"}</Txt>
          {a.meta ? <Txt v="caption" selectable>Details: {JSON.stringify(a.meta)}</Txt> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

export default function Audit() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [group, setGroup] = useState("");
  const [range, setRange] = useState<RangeKey>("all");
  const [exportOpen, setExportOpen] = useState(false);
  const dates = rangeDates(range);
  const q = usePaged<AuditEntry>("audit", "/audit", { action: group || undefined, ...dates, limit: 50 });
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Audit log" subtitle="Who · what · when · where · before/after · reason" back
        right={<IconButton icon="download-outline" onPress={() => setExportOpen(true)} testID="audit-export-button" label="Export" />}>
        <ChipRow testID="audit-group-chips">{GROUPS.map((g) => <Chip key={g.label} label={g.label} selected={group === g.key} onPress={() => setGroup(g.key)} testID={`audit-group-${g.label.toLowerCase()}`} />)}</ChipRow>
        <ChipRow testID="audit-range-chips">{RANGE.map((r) => <Chip key={r.key} label={r.label} selected={range === r.key} onPress={() => setRange(r.key)} testID={`audit-range-${r.key}`} />)}</ChipRow>
      </AppHeader>
      <InfiniteList query={q} testID="audit-list" bottomPad={insets.bottom} emptyTitle="No audit entries" emptyIcon="shield-checkmark-outline" renderItem={(a) => <Row a={a} />} />
      <ExportSheet visible={exportOpen} onClose={() => setExportOpen(false)} report="audit" params={dates} title="Export audit log" />
    </View>
  );
}
