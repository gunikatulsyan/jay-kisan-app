import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, qs } from "@/src/api/client";
import type { Page, Txn } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { AppHeader } from "@/src/components/AppHeader";
import { ProductFinder } from "@/src/components/ProductFinder";
import { TxnRow } from "@/src/components/TxnRow";
import { Banner, Empty, IconButton, SectionTitle, Txt } from "@/src/components/ui";
import { WarehousePicker } from "@/src/components/WarehousePicker";
import { useWarehouse } from "@/src/context/WarehouseContext";
import { fmtQty, rangeDates } from "@/src/utils/format";
import { spacing, useTheme } from "@/src/theme";

export default function EmployeeHome() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { me, logout } = useAuth();
  const { selected, warehouses } = useWarehouse();
  const today = rangeDates("today");
  const recent = useQuery({
    queryKey: ["transactions", "mine-today"],
    queryFn: () => api<Page<Txn>>(`/transactions${qs({ ...today, type: "SALE,CORRECTION", limit: 10 })}`),
  });
  const items = recent.data?.items ?? [];
  const units = items.filter((t) => t.type === "SALE").reduce((s, t) => s + -t.quantity_change, 0);
  const warehouseId = selected && selected !== "all" ? selected : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title={`Namaste, ${me?.user.full_name.split(" ")[0] ?? ""}`} subtitle="Employee · Jay Kisan"
        right={<>
          <IconButton icon="time-outline" onPress={() => router.push("/history")} testID="employee-history-button" label="My history" />
          <IconButton icon="key-outline" onPress={() => router.push("/change-password")} testID="employee-password-button" label="Change password" />
          <IconButton icon="log-out-outline" onPress={() => logout()} testID="employee-logout-button" label="Sign out" />
        </>} />
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 720, width: "100%", alignSelf: "center" }}>
        {warehouses.length === 0 ? <Banner tone="warning" text="You are not assigned to any warehouse. Please contact the owner." testID="no-warehouse-banner" /> : <WarehousePicker />}
        <ProductFinder warehouseId={warehouseId} onPick={(id) => router.push({ pathname: "/sell", params: { product_id: id } })} />
        <View>
          <SectionTitle title="My sales today" action={<Txt v="bodyMedium" color={colors.brandPrimary} testID="today-units">{fmtQty(units)} units</Txt>} />
          {items.length === 0 ? <Empty icon="cart-outline" title="No sales yet today" message="Scan or search a product to record a sale." /> : (
            <View style={{ gap: spacing.sm }}>
              {items.map((t) => <TxnRow key={t.id} t={t} showCost={false} onPress={() => router.push(`/transaction/${t.id}`)} />)}
            </View>
          )}
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
