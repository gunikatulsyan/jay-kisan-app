import { useState } from "react";
import { Pressable, View } from "react-native";

import { useWarehouse } from "@/src/context/WarehouseContext";
import { Icon } from "@/src/components/Icon";
import { Sheet, Txt } from "@/src/components/ui";
import { radius, spacing, useTheme } from "@/src/theme";

// Warehouse selector pill. Uncontrolled = global context. Controlled = form field (value/onChange).
export function WarehousePicker({ value, onChange, allowAll, testID = "warehouse-picker", label = "Warehouse", exclude }: {
  value?: string; onChange?: (id: string) => void; allowAll?: boolean; testID?: string; label?: string; exclude?: string;
}) {
  const { colors } = useTheme();
  const ctx = useWarehouse();
  const [open, setOpen] = useState(false);
  const selected = value ?? ctx.selected;
  const set = onChange ?? ctx.setSelected;
  const canAll = allowAll ?? (ctx.canSelectAll && !onChange);
  const options = [...(canAll ? [{ id: "all", name: "All Warehouses", code: "ALL" }] : []), ...ctx.warehouses.filter((w) => w.id !== exclude)];
  const current = options.find((o) => o.id === selected);
  const locked = options.length <= 1 && !!current;
  return (
    <>
      <Pressable testID={testID} disabled={locked} onPress={() => setOpen(true)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.md,
          backgroundColor: pressed ? colors.brandSecondary : colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary, alignSelf: "flex-start" })}>
        <Icon name="business-outline" size={18} color={colors.brand} />
        <View>
          <Txt v="caption" color={colors.onBrandTertiary}>{label}</Txt>
          <Txt v="bodyMedium" color={colors.brand} testID={`${testID}-value`}>{current?.name ?? "Select warehouse"}</Txt>
        </View>
        {!locked ? <Icon name="chevron-down" size={16} color={colors.brand} /> : null}
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={`Select ${label.toLowerCase()}`} testID={`${testID}-sheet`}>
        {options.map((o) => {
          const active = o.id === selected;
          return (
            <Pressable key={o.id} testID={`${testID}-option-${o.code}`} onPress={() => { set(o.id); setOpen(false); }}
              style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.md, borderRadius: radius.md,
                backgroundColor: active ? colors.brandTertiary : colors.surface, borderWidth: 1, borderColor: active ? colors.brandPrimary : colors.border }}>
              <Icon name={o.id === "all" ? "grid-outline" : "business-outline"} color={active ? colors.brandPrimary : colors.onSurfaceSecondary} />
              <Txt v="subtitle" style={{ flex: 1 }}>{o.name}</Txt>
              <Txt v="caption">{o.code}</Txt>
              {active ? <Icon name="checkmark-circle" color={colors.brandPrimary} /> : null}
            </Pressable>
          );
        })}
      </Sheet>
    </>
  );
}
