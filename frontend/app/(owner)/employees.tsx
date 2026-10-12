import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage } from "@/src/api/client";
import type { User, Warehouse } from "@/src/api/types";
import { AppHeader } from "@/src/components/AppHeader";
import { useToast } from "@/src/components/Toast";
import { Badge, Banner, Button, Card, Checkbox, Chip, ErrorView, Field, Loading, Sheet, Txt } from "@/src/components/ui";
import { fmtDateTime, fmtRelative } from "@/src/utils/format";
import { spacing, useTheme } from "@/src/theme";

type Form = { id?: string; username: string; full_name: string; phone: string; role: "employee" | "owner"; password: string; warehouse_ids: string[]; active: boolean };

export default function Employees() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ["users"], queryFn: () => api<User[]>("/users") });
  const whs = useQuery({ queryKey: ["warehouses", "all"], queryFn: () => api<Warehouse[]>("/warehouses?include_inactive=true") });
  const [form, setForm] = useState<Form | null>(null);
  const [code, setCode] = useState<{ user: string; code: string; expires: string } | null>(null);
  const [temp, setTemp] = useState<{ user: User; password: string } | null>(null);
  const whName = (id: string) => whs.data?.find((w) => w.id === id)?.name ?? "—";
  const refresh = () => qc.invalidateQueries({ queryKey: ["users"] });

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      if (f.id) return api(`/users/${f.id}`, { method: "PATCH", body: { full_name: f.full_name.trim(), phone: f.phone.trim() || null, role: f.role, warehouse_ids: f.warehouse_ids, active: f.active } });
      return api("/users", { method: "POST", body: { username: f.username.trim(), full_name: f.full_name.trim(), phone: f.phone.trim() || null, role: f.role, password: f.password, warehouse_ids: f.warehouse_ids } });
    },
    onSuccess: () => { toast.show({ title: form?.id ? "Employee updated" : "Employee created", message: form?.id ? undefined : "They must change the password at first sign-in.", tone: "success" }); setForm(null); refresh(); },
  });
  const resetCode = useMutation({
    mutationFn: (u: User) => api<{ code: string; expires_at: string }>(`/users/${u.id}/reset-code`, { method: "POST" }),
    onSuccess: (r, u) => setCode({ user: u.full_name, code: r.code, expires: r.expires_at }),
    onError: (e) => toast.show({ title: "Failed", message: errorMessage(e), tone: "error" }),
  });
  const setPassword = useMutation({
    mutationFn: () => api(`/users/${temp!.user.id}/set-password`, { method: "POST", body: { password: temp!.password } }),
    onSuccess: () => { toast.show({ title: "Temporary password set", message: "All sessions for this user were signed out.", tone: "success" }); setTemp(null); },
  });
  const toggleWh = (id: string) => form && setForm({ ...form, warehouse_ids: form.warehouse_ids.includes(id) ? form.warehouse_ids.filter((x) => x !== id) : [...form.warehouse_ids, id] });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Employees" subtitle="Accounts & warehouse permissions" back
        right={<Button title="New" size="sm" icon="person-add-outline" onPress={() => setForm({ username: "", full_name: "", phone: "", role: "employee", password: "", warehouse_ids: [], active: true })} testID="add-employee-button" />} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, paddingBottom: insets.bottom + spacing.xl, maxWidth: 900, width: "100%", alignSelf: "center" }}>
        {users.isLoading ? <Loading /> : users.isError ? <ErrorView message={errorMessage(users.error)} onRetry={() => users.refetch()} /> : users.data!.map((u) => (
          <Card key={u.id} style={{ gap: spacing.sm }} testID={`employee-card-${u.username}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Txt v="subtitle">{u.full_name}</Txt>
                <Txt v="caption">@{u.username}{u.phone ? ` · ${u.phone}` : ""} · last login {u.last_login_at ? fmtRelative(u.last_login_at) : "never"}</Txt>
              </View>
              <Badge label={u.role.toUpperCase()} tone={u.role === "owner" ? "inverse" : "brand"} />
              <Badge label={u.active ? "ACTIVE" : "DISABLED"} tone={u.active ? "success" : "neutral"} />
            </View>
            {u.role === "employee" ? <Txt v="body" color={colors.onSurfaceSecondary}>Warehouses: {u.warehouse_ids.map(whName).join(", ") || "none"}</Txt> : null}
            {u.must_change_password ? <Txt v="caption" color={colors.warning}>Must change password at next sign-in</Txt> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              <Button title="Edit / permissions" size="sm" variant="outline" testID={`edit-employee-${u.username}`}
                onPress={() => setForm({ id: u.id, username: u.username, full_name: u.full_name, phone: u.phone ?? "", role: u.role, password: "", warehouse_ids: u.warehouse_ids, active: u.active })} />
              <Button title="Reset code" size="sm" variant="ghost" icon="key-outline" onPress={() => resetCode.mutate(u)} testID={`reset-code-${u.username}`} />
              <Button title="Set temp password" size="sm" variant="ghost" onPress={() => setTemp({ user: u, password: "" })} testID={`temp-password-${u.username}`} />
            </View>
          </Card>
        ))}
      </ScrollView>
      <Sheet visible={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit employee" : "New employee"} testID="employee-form-sheet">
        {form ? (
          <>
            <Field label="Employee ID / username *" value={form.username} editable={!form.id} onChangeText={(v) => setForm({ ...form, username: v.toLowerCase() })} autoCapitalize="none" testID="employee-username-input" />
            <Field label="Full name *" value={form.full_name} onChangeText={(v) => setForm({ ...form, full_name: v })} testID="employee-name-input" />
            <Field label="Phone" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" testID="employee-phone-input" />
            {!form.id ? <Field label="Temporary password *" value={form.password} onChangeText={(v) => setForm({ ...form, password: v })} secureTextEntry hint="8+ characters, letters and numbers. They will be asked to change it." testID="employee-password-input" /> : null}
            <Txt v="bodyMedium" color={colors.onSurfaceSecondary}>Role</Txt>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Chip label="Employee" selected={form.role === "employee"} onPress={() => setForm({ ...form, role: "employee" })} testID="role-employee" />
              <Chip label="Owner / Admin" selected={form.role === "owner"} onPress={() => setForm({ ...form, role: "owner" })} testID="role-owner" />
            </View>
            {form.role === "employee" ? (
              <>
                <Txt v="bodyMedium" color={colors.onSurfaceSecondary}>Assigned warehouses *</Txt>
                {whs.data?.filter((w) => w.active).map((w) => <Checkbox key={w.id} checked={form.warehouse_ids.includes(w.id)} onToggle={() => toggleWh(w.id)} label={w.name} testID={`assign-warehouse-${w.code}`} />)}
              </>
            ) : <Banner tone="warning" text="Owners have full access to every warehouse and all settings." />}
            {form.id ? <Checkbox checked={form.active} onToggle={() => setForm({ ...form, active: !form.active })} label="Account active (unchecked = disabled & signed out)" testID="employee-active-checkbox" /> : null}
            {save.isError ? <Banner tone="error" text={errorMessage(save.error)} testID="employee-form-error" /> : null}
            <Button title="Save" loading={save.isPending} onPress={() => save.mutate()} testID="save-employee-button"
              disabled={!form.full_name.trim() || (!form.id && (!form.username.trim() || form.password.length < 8)) || (form.role === "employee" && form.warehouse_ids.length === 0)} />
          </>
        ) : null}
      </Sheet>
      <Sheet visible={!!code} onClose={() => setCode(null)} title="One-time reset code" testID="reset-code-sheet">
        <Txt v="body">Give this code to {code?.user}. They can use “Forgot password?” on the sign-in screen.</Txt>
        <Card style={{ alignItems: "center" }}><Txt v="display" selectable testID="reset-code-value">{code?.code}</Txt></Card>
        <Txt v="caption">Expires {fmtDateTime(code?.expires)} · single use · shown only once</Txt>
      </Sheet>
      <Sheet visible={!!temp} onClose={() => setTemp(null)} title={`Temporary password · ${temp?.user.full_name ?? ""}`} testID="temp-password-sheet">
        {temp ? (
          <>
            <Field label="New temporary password" value={temp.password} onChangeText={(v) => setTemp({ ...temp, password: v })} secureTextEntry testID="temp-password-input" />
            {setPassword.isError ? <Banner tone="error" text={errorMessage(setPassword.error)} /> : null}
            <Button title="Set password" loading={setPassword.isPending} disabled={temp.password.length < 8} onPress={() => setPassword.mutate()} testID="save-temp-password" />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}
