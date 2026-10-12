import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Txn } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { InfiniteList, usePaged } from "@/src/components/DataList";
import { TxnRow } from "@/src/components/TxnRow";
import { Chip, ChipRow } from "@/src/components/ui";
import { RangeKey, rangeDates } from "@/src/utils/format";
import { useTheme } from "@/src/theme";

const OPTS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" }, { key: "7d", label: "7 days" }, { key: "30d", label: "30 days" }, { key: "all", label: "All" },
];

export default function History() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState<RangeKey>("today");
  const q = usePaged<Txn>("transactions", "/transactions", { ...rangeDates(range), limit: 30 });
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="My transactions" back>
        <ChipRow testID="history-range-chips">
          {OPTS.map((o) => <Chip key={o.key} label={o.label} selected={range === o.key} onPress={() => setRange(o.key)} testID={`history-range-${o.key}`} />)}
        </ChipRow>
      </AppHeader>
      <InfiniteList query={q} testID="history-list" bottomPad={insets.bottom} emptyTitle="No transactions" emptyMessage="Your sales will appear here." emptyIcon="receipt-outline"
        renderItem={(t) => <TxnRow t={t} showCost={false} onPress={() => router.push(`/transaction/${t.id}`)} />} />
    </View>
  );
}
