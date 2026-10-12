import { InfiniteData, useInfiniteQuery, UseInfiniteQueryResult } from "@tanstack/react-query";
import { ReactNode, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

import { api, errorMessage, qs } from "@/src/api/client";
import type { Page } from "@/src/api/types";
import { IconName } from "@/src/components/Icon";
import { Empty, ErrorView, Loading, Txt } from "@/src/components/ui";
import { useIsWide } from "@/src/navigation";
import { radius, spacing, useTheme } from "@/src/theme";

export function usePaged<T>(key: string, path: string, params: Record<string, any>, enabled = true) {
  return useInfiniteQuery({
    queryKey: [key, path, params],
    queryFn: ({ pageParam }) => api<Page<T>>(path + qs({ ...params, cursor: pageParam })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export type Column<T> = { key: string; title: string; flex?: number; align?: "left" | "right"; render: (item: T) => ReactNode };

// Server-paginated list. Phones: rows via renderItem. Wide screens: data table via columns.
export function InfiniteList<T extends { id: string }>({
  query, columns, renderItem, onPressItem, emptyTitle, emptyMessage, emptyIcon, header, testID, bottomPad = 0,
}: {
  query: UseInfiniteQueryResult<InfiniteData<Page<T>>>;
  columns?: Column<T>[];
  renderItem: (item: T) => ReactNode;
  onPressItem?: (item: T) => void;
  emptyTitle: string;
  emptyMessage?: string;
  emptyIcon?: IconName;
  header?: ReactNode;
  testID?: string;
  bottomPad?: number;
}) {
  const { colors } = useTheme();
  const wide = useIsWide() && !!columns;
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const onEnd = () => {
    if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
  };
  const empty = query.isLoading ? <Loading /> : query.isError ? <ErrorView message={errorMessage(query.error)} onRetry={() => query.refetch()} /> : (
    <Empty title={emptyTitle} message={emptyMessage} icon={emptyIcon} />
  );
  const footer = query.isFetchingNextPage ? <Loading /> : <View style={{ height: spacing.lg + bottomPad }} />;
  const refresh = <RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => query.refetch()} tintColor={colors.brandPrimary} />;

  if (wide) {
    return (
      <View style={{ flex: 1, padding: spacing.lg, gap: spacing.md }}>
        {header}
        <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surfaceTertiary, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            {columns!.map((c) => (
              <Txt key={c.key} v="label" style={{ flex: c.flex ?? 1, textAlign: c.align ?? "left" }}>{c.title}</Txt>
            ))}
          </View>
          <FlatList
            testID={testID}
            data={items}
            keyExtractor={(i) => i.id}
            onEndReached={onEnd}
            onEndReachedThreshold={0.5}
            refreshControl={refresh}
            ListEmptyComponent={empty}
            ListFooterComponent={query.isFetchingNextPage ? <Loading /> : null}
            renderItem={({ item }) => (
              <Pressable onPress={onPressItem ? () => onPressItem(item) : undefined} testID={`row-${item.id}`}
                style={({ pressed, hovered }: any) => ({ flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider, backgroundColor: pressed || hovered ? colors.brandTertiary : "transparent" })}>
                {columns!.map((c) => (
                  <View key={c.key} style={{ flex: c.flex ?? 1, alignItems: c.align === "right" ? "flex-end" : "flex-start", paddingRight: spacing.sm }}>
                    {c.render(item)}
                  </View>
                ))}
              </Pressable>
            )}
          />
        </View>
      </View>
    );
  }

  return (
    <FlatList
      testID={testID}
      data={items}
      keyExtractor={(i) => i.id}
      onEndReached={onEnd}
      onEndReachedThreshold={0.5}
      refreshControl={refresh}
      ListHeaderComponent={header ? <View style={{ marginBottom: spacing.md }}>{header}</View> : null}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
      renderItem={({ item }) =>
        onPressItem ? (
          <Pressable onPress={() => onPressItem(item)} testID={`row-${item.id}`} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            {renderItem(item)}
          </Pressable>
        ) : (
          <>{renderItem(item)}</>
        )
      }
    />
  );
}
