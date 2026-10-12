import { useMutation, useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useMemo, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { api, ApiError, BACKEND_URL, errorMessage } from "@/src/api/client";
import type { Category, Customer } from "@/src/api/types";
import { useDebounced, usePaged } from "@/src/components/DataList";
import { Icon } from "@/src/components/Icon";
import { useToast } from "@/src/components/Toast";
import { Banner, Button, Field, Loading, Sheet, Txt } from "@/src/components/ui";
import { radius, spacing, useTheme } from "@/src/theme";

export function useCategories(includeInactive = false) {
  return useQuery({ queryKey: ["categories", includeInactive], queryFn: () => api<Category[]>(`/categories?include_inactive=${includeInactive}`) });
}

// Ordered depth-first with full path labels ("Agricultural Products › Fertilizers › Urea").
export function useCategoryTree(includeInactive = false) {
  const q = useCategories(includeInactive);
  const tree = useMemo(() => {
    const cats = q.data ?? [];
    const byId = new Map(cats.map((c) => [c.id, c]));
    const children = new Map<string | null, Category[]>();
    cats.forEach((c) => {
      const k = c.parent_id && byId.has(c.parent_id) ? c.parent_id : null;
      children.set(k, [...(children.get(k) ?? []), c]);
    });
    const out: (Category & { path: string; childCount: number })[] = [];
    const walk = (pid: string | null, prefix: string) => {
      (children.get(pid) ?? []).sort((a, b) => a.name.localeCompare(b.name)).forEach((c) => {
        const path = prefix ? `${prefix} › ${c.name}` : c.name;
        out.push({ ...c, path, childCount: (children.get(c.id) ?? []).length });
        walk(c.id, path);
      });
    };
    walk(null, "");
    return out;
  }, [q.data]);
  return { ...q, tree };
}

export function CategoryPicker({ visible, onClose, onSelect, selectedId, allowNone = true, excludeId, title = "Select category" }: {
  visible: boolean; onClose: () => void; onSelect: (c: { id: string | null; path: string }) => void; selectedId?: string | null; allowNone?: boolean; excludeId?: string; title?: string;
}) {
  const { colors } = useTheme();
  const { tree, isLoading } = useCategoryTree();
  const [q, setQ] = useState("");
  const items = tree.filter((c) => (!excludeId || (c.id !== excludeId && !c.ancestors.includes(excludeId))) && (!q || c.path.toLowerCase().includes(q.toLowerCase())));
  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID="category-picker">
      <Field placeholder="Search categories" value={q} onChangeText={setQ} testID="category-picker-search" />
      {allowNone ? (
        <Pressable testID="category-option-none" onPress={() => { onSelect({ id: null, path: "" }); onClose(); }} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md }}>
          <Txt v="bodyMedium" color={colors.muted}>No category / top level</Txt>
        </Pressable>
      ) : null}
      {isLoading ? <Loading /> : items.map((c) => (
        <Pressable key={c.id} testID={`category-option-${c.id}`} onPress={() => { onSelect({ id: c.id, path: c.path }); onClose(); }}
          style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingLeft: spacing.md + (q ? 0 : c.depth * 16), paddingRight: spacing.md, borderRadius: radius.sm, backgroundColor: c.id === selectedId ? colors.brandTertiary : "transparent" }}>
          <Icon name={c.childCount ? "folder-open-outline" : "pricetag-outline"} size={16} color={colors.onSurfaceSecondary} />
          <Txt v={c.depth === 0 ? "bodyMedium" : "body"} style={{ flex: 1 }}>{q ? c.path : c.name}</Txt>
          {c.id === selectedId ? <Icon name="checkmark" color={colors.brandPrimary} /> : null}
        </Pressable>
      ))}
    </Sheet>
  );
}

export function CustomerPicker({ visible, onClose, onSelect }: { visible: boolean; onClose: () => void; onSelect: (c: Customer) => void }) {
  const { colors } = useTheme();
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "", tax_id: "" });
  const [dup, setDup] = useState<{ customer_id: string; name: string } | null>(null);
  const list = usePaged<Customer>("customers", "/customers", { q: dq, limit: 20 }, visible);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const create = useMutation({
    mutationFn: () => api<Customer>("/customers", { method: "POST", body: { name: form.name.trim(), phone: form.phone.trim() || null, address: form.address.trim() || null, tax_id: form.tax_id.trim() || null } }),
    onSuccess: (c) => { pick(c); },
    onError: (e) => { if (e instanceof ApiError && e.code === "DUPLICATE_CUSTOMER") setDup(e.details); },
  });
  const pick = (c: Customer) => {
    onSelect(c);
    setCreating(false);
    setForm({ name: "", phone: "", address: "", tax_id: "" });
    setDup(null);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={creating ? "New customer" : "Sold to"} testID="customer-picker">
      {creating ? (
        <>
          <Field label="Customer / business name *" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} testID="new-customer-name" autoFocus />
          <Field label="Phone" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" testID="new-customer-phone" />
          <Field label="Address" value={form.address} onChangeText={(v) => setForm({ ...form, address: v })} testID="new-customer-address" />
          <Field label="PAN / VAT (optional)" value={form.tax_id} onChangeText={(v) => setForm({ ...form, tax_id: v })} testID="new-customer-tax" />
          {create.isError && !dup ? <Banner tone="error" text={errorMessage(create.error)} /> : null}
          {dup ? (
            <View style={{ gap: spacing.sm }}>
              <Banner tone="warning" text={`A customer with this phone already exists: ${dup.name}`} />
              <Button title={`Use ${dup.name}`} variant="secondary" testID="use-existing-customer"
                onPress={async () => pick(await api<Customer>(`/customers/${dup.customer_id}`))} />
            </View>
          ) : null}
          <Button title="Save customer" size="lg" icon="checkmark" loading={create.isPending} disabled={!form.name.trim()} onPress={() => create.mutate()} testID="save-customer-button" />
          <Button title="Back to search" variant="ghost" onPress={() => setCreating(false)} testID="back-to-customer-search" />
        </>
      ) : (
        <>
          <Field placeholder="Search name or phone" value={q} onChangeText={setQ} testID="customer-search-input" autoFocus
            right={<View style={{ paddingRight: spacing.md }}><Icon name="search" size={18} color={colors.muted} /></View>} />
          <Button title="New customer" icon="person-add-outline" variant="secondary" onPress={() => { setCreating(true); setForm((f) => ({ ...f, name: q })); }} testID="new-customer-button" />
          {list.isLoading ? <Loading /> : items.length === 0 ? <Txt v="body" color={colors.muted} style={{ textAlign: "center", padding: spacing.lg }}>No customers found</Txt> : items.map((c) => (
            <Pressable key={c.id} testID={`customer-option-${c.id}`} onPress={() => pick(c)}
              style={({ pressed }) => ({ minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: pressed ? colors.brandTertiary : colors.surface })}>
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.brandSecondary, alignItems: "center", justifyContent: "center" }}>
                <Txt v="bodyMedium" color={colors.brand}>{c.name.slice(0, 1).toUpperCase()}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt v="bodyMedium">{c.name}</Txt>
                <Txt v="caption">{[c.phone, c.address].filter(Boolean).join(" · ") || "—"}</Txt>
              </View>
            </Pressable>
          ))}
          {list.hasNextPage ? <Button title="Load more" variant="ghost" onPress={() => list.fetchNextPage()} testID="customers-load-more" /> : null}
        </>
      )}
    </Sheet>
  );
}

export function ExportSheet({ visible, onClose, report, params = {}, title = "Export" }: {
  visible: boolean; onClose: () => void; report: string; params?: Record<string, string | undefined>; title?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (format: "csv" | "xlsx" | "pdf") => {
    setBusy(format);
    try {
      const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v && v !== "all")) as Record<string, string>;
      const t = await api<{ url: string }>("/exports/ticket", { method: "POST", body: { report, format, params: clean } });
      const url = `${BACKEND_URL}${t.url}`;
      if (Platform.OS === "web") (globalThis as any).window?.open(url, "_blank");
      else await Linking.openURL(url);
      toast.show({ title: "Export started", message: "Your file is downloading.", tone: "success" });
      onClose();
    } catch (e) {
      toast.show({ title: "Export failed", message: errorMessage(e), tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID="export-sheet">
      <Txt v="body">Choose a file format. Large exports are generated on the server.</Txt>
      <Button title="CSV" icon="document-text-outline" variant="outline" loading={busy === "csv"} onPress={() => go("csv")} testID="export-csv-button" />
      <Button title="Excel (.xlsx)" icon="grid-outline" variant="outline" loading={busy === "xlsx"} onPress={() => go("xlsx")} testID="export-xlsx-button" />
      <Button title="PDF" icon="document-outline" variant="outline" loading={busy === "pdf"} onPress={() => go("pdf")} testID="export-pdf-button" />
    </Sheet>
  );
}
