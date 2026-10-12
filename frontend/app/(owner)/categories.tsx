import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage } from "@/src/api/client";
import type { Category } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { Icon } from "@/src/components/Icon";
import { CategoryPicker, useCategoryTree } from "@/src/components/Pickers";
import { useToast } from "@/src/components/Toast";
import { Badge, Banner, Button, Card, ErrorView, Field, IconButton, Loading, Sheet, Txt } from "@/src/components/ui";
import { radius, spacing, useTheme } from "@/src/theme";

type Node = Category & { path: string; childCount: number };

export default function Categories() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const { tree, isLoading, isError, error, refetch } = useCategoryTree(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<Node | null>(null);
  const [form, setForm] = useState<{ mode: "create" | "rename"; parent?: Node | null; node?: Node; name: string } | null>(null);
  const [moving, setMoving] = useState<Node | null>(null);

  const done = (title: string) => { toast.show({ title, tone: "success" }); qc.invalidateQueries({ queryKey: ["categories"] }); setMenu(null); setForm(null); };
  const save = useMutation({
    mutationFn: () => form!.mode === "create"
      ? api("/categories", { method: "POST", body: { name: form!.name.trim(), parent_id: form!.parent?.id ?? null } })
      : api(`/categories/${form!.node!.id}`, { method: "PATCH", body: { name: form!.name.trim() } }),
    onSuccess: () => done(form?.mode === "create" ? "Category created" : "Category renamed"),
  });
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: any }) => api(path, { method: "POST", body }),
    onSuccess: () => done("Category updated"),
    onError: (e) => toast.show({ title: "Could not update", message: errorMessage(e), tone: "error" }),
  });

  const hidden = (n: Node) => n.ancestors.some((a) => collapsed.has(a));
  const toggle = (id: string) => setCollapsed((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Categories" subtitle="Unlimited nesting" back right={<Button title="Add top-level" size="sm" icon="add" onPress={() => setForm({ mode: "create", parent: null, name: "" })} testID="add-root-category-button" />} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 820, width: "100%", alignSelf: "center" }}>
        {isLoading ? <Loading /> : isError ? <ErrorView message={errorMessage(error)} onRetry={refetch} /> : (
          <Card style={{ padding: spacing.sm }} testID="category-tree">
            {tree.length === 0 ? <Txt v="body" color={colors.muted} style={{ padding: spacing.md }}>No categories yet.</Txt> : null}
            {tree.filter((n) => !hidden(n)).map((n) => (
              <View key={n.id} style={{ flexDirection: "row", alignItems: "center", minHeight: 48, paddingLeft: n.depth * 20, borderBottomWidth: 1, borderBottomColor: colors.divider }} testID={`category-node-${n.id}`}>
                <Pressable onPress={() => n.childCount && toggle(n.id)} style={{ width: 32, alignItems: "center" }} hitSlop={6}>
                  {n.childCount ? <Icon name={collapsed.has(n.id) ? "chevron-forward" : "chevron-down"} size={16} color={colors.muted} /> : <Icon name="pricetag-outline" size={14} color={colors.muted} />}
                </Pressable>
                <Txt v={n.depth === 0 ? "subtitle" : "body"} style={{ flex: 1 }} color={n.active ? colors.onSurface : colors.muted}>{n.name}</Txt>
                {!n.active ? <Badge label="INACTIVE" /> : null}
                {n.childCount ? <Txt v="caption" style={{ marginHorizontal: spacing.sm }}>{n.childCount}</Txt> : null}
                <IconButton icon="ellipsis-horizontal" onPress={() => setMenu(n)} testID={`category-menu-${n.id}`} label="Actions" />
              </View>
            ))}
          </Card>
        )}
      </ScrollView>
      <Sheet visible={!!menu} onClose={() => setMenu(null)} title={menu?.path} testID="category-actions-sheet">
        {menu ? (
          <>
            <Button title="Add subcategory" icon="add" variant="outline" onPress={() => { setForm({ mode: "create", parent: menu, name: "" }); setMenu(null); }} testID="category-add-sub" />
            <Button title="Rename" icon="create-outline" variant="outline" onPress={() => { setForm({ mode: "rename", node: menu, name: menu.name }); setMenu(null); }} testID="category-rename" />
            <Button title="Move to another parent" icon="move-outline" variant="outline" onPress={() => { setMoving(menu); setMenu(null); }} testID="category-move" />
            {menu.active ? <Button title="Deactivate" icon="archive-outline" variant="ghost" loading={act.isPending} onPress={() => act.mutate({ path: `/categories/${menu.id}/deactivate` })} testID="category-deactivate" />
              : <Button title="Reactivate" icon="refresh" variant="ghost" loading={act.isPending} onPress={() => act.mutate({ path: `/categories/${menu.id}/activate` })} testID="category-activate" />}
          </>
        ) : null}
      </Sheet>
      <Sheet visible={!!form} onClose={() => setForm(null)} title={form?.mode === "create" ? (form.parent ? `New subcategory in ${form.parent.name}` : "New top-level category") : "Rename category"} testID="category-form-sheet">
        {form ? (
          <>
            <Field label="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} autoFocus testID="category-name-input" />
            {save.isError ? <Banner tone="error" text={errorMessage(save.error)} /> : null}
            <Button title="Save" loading={save.isPending} disabled={!form.name.trim()} onPress={() => save.mutate()} testID="save-category-button" />
          </>
        ) : null}
      </Sheet>
      <CategoryPicker visible={!!moving} onClose={() => setMoving(null)} excludeId={moving?.id} title={`Move “${moving?.name ?? ""}” under…`}
        onSelect={(c) => moving && act.mutate({ path: `/categories/${moving.id}/move`, body: { parent_id: c.id } })} />
      <View style={{ borderRadius: radius.sm }} />
    </View>
  );
}
