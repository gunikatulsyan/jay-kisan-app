import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, errorMessage } from "@/src/api/client";
import { AppHeader } from "@/src/components/AppHeader";
import { Badge, Banner, Button, Card, KV, Loading, SectionTitle, Txt } from "@/src/components/ui";
import { fmtQty } from "@/src/utils/format";
import { radius, spacing, useTheme } from "@/src/theme";

type Job = {
  id: string; job_no: string; filename: string; status: "preview" | "committing" | "completed";
  stats: { total: number; valid: number; invalid: number; creates: number; updates: number; stock_rows: number };
  result: { imported: number; failed: number; stock_rows: number } | null;
  rows: { row_no: number; valid: boolean; errors: string[]; action: string; sku: string; name?: string; quantity?: number | null; warehouse_code?: string }[];
};
const COLS = "sku*, name*, category (e.g. Agricultural Products > Fertilizers > Urea), brand, unit, barcode, supplier, purchase_price, selling_price, min_stock, batch_no, expiry_date (YYYY-MM-DD), description, warehouse_code, quantity";

export default function ImportScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useQuery({
    queryKey: ["import", jobId], queryFn: () => api<Job>(`/imports/${jobId}`), enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === "committing" ? 1500 : false),
  });
  const upload = useMutation({
    mutationFn: async () => {
      const res = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "*/*"], copyToCacheDirectory: true });
      if (res.canceled) return null;
      const a = res.assets[0];
      const form = new FormData();
      if (Platform.OS === "web" && (a as any).file) form.append("file", (a as any).file, a.name);
      else form.append("file", { uri: a.uri, name: a.name, type: a.mimeType ?? "application/octet-stream" } as any);
      return api<Job>("/imports/products", { method: "POST", form });
    },
    onSuccess: (j) => { if (j) { qc.setQueryData(["import", j.id], j); setJobId(j.id); } },
  });
  const commit = useMutation({
    mutationFn: () => api<Job>(`/imports/${jobId}/commit`, { method: "POST" }),
    onSuccess: (j) => { qc.setQueryData(["import", j.id], { ...j, status: "committing" }); ["products", "inventory", "dashboard", "categories"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
  });
  const j = job.data;
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppHeader title="Bulk import" subtitle="Products & opening stock (CSV / Excel)" back />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg, paddingBottom: insets.bottom + spacing.xl, maxWidth: 900, width: "100%", alignSelf: "center" }}>
        <Card style={{ gap: spacing.md }}>
          <SectionTitle title="1 · Upload file" />
          <Txt v="body" color={colors.muted}>Columns: {COLS}. Up to 5,000 rows / 5 MB per file. Existing SKUs are updated; quantity rows create audited STOCK_IN transactions. Nothing is saved until you confirm.</Txt>
          <Button title={j ? "Upload another file" : "Choose CSV / XLSX file"} icon="cloud-upload-outline" loading={upload.isPending} onPress={() => upload.mutate()} testID="import-upload-button" />
          {upload.isError ? <Banner tone="error" text={errorMessage(upload.error)} testID="import-error" /> : null}
        </Card>
        {job.isLoading && jobId ? <Loading /> : null}
        {j ? (
          <>
            <Card style={{ gap: 0 }} testID="import-preview">
              <SectionTitle title={`2 · Preview · ${j.filename}`} action={<Badge label={j.status.toUpperCase()} tone={j.status === "completed" ? "success" : j.status === "committing" ? "warning" : "brand"} />} />
              <KV label="Rows in file" value={fmtQty(j.stats.total)} />
              <KV label="Valid rows" value={fmtQty(j.stats.valid)} testID="import-valid-count" />
              <KV label="Rows with errors (skipped)" value={fmtQty(j.stats.invalid)} testID="import-invalid-count" />
              <KV label="New products / updates" value={`${fmtQty(j.stats.creates)} / ${fmtQty(j.stats.updates)}`} />
              <KV label="Stock-in rows" value={fmtQty(j.stats.stock_rows)} />
            </Card>
            {j.rows.some((r) => !r.valid) ? (
              <Card style={{ gap: spacing.sm }}>
                <SectionTitle title="Rows with errors" />
                {j.rows.filter((r) => !r.valid).map((r) => (
                  <View key={r.row_no} style={{ padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.errorSoft }}>
                    <Txt v="bodyMedium" color={colors.error}>Row {r.row_no} · {r.sku || "(no sku)"}</Txt>
                    <Txt v="caption" color={colors.error}>{r.errors.join("; ")}</Txt>
                  </View>
                ))}
              </Card>
            ) : null}
            {j.status === "preview" ? (
              <Button title={`3 · Import ${fmtQty(j.stats.valid)} valid rows`} size="lg" icon="checkmark-done" disabled={j.stats.valid === 0} loading={commit.isPending} onPress={() => commit.mutate()} testID="import-commit-button" />
            ) : j.status === "committing" ? <Banner tone="neutral" text="Importing… you can leave this screen; the import continues on the server." /> : (
              <Banner tone={j.result?.failed ? "warning" : "success"} testID="import-result"
                text={`Import complete: ${fmtQty(j.result?.imported)} rows imported, ${fmtQty(j.result?.stock_rows)} stock-in transactions, ${fmtQty(j.result?.failed)} failed.`} />
            )}
            {commit.isError ? <Banner tone="error" text={errorMessage(commit.error)} /> : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
