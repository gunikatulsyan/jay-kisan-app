const nf = new Intl.NumberFormat("en-IN");
const mf = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const fmtQty = (n?: number | null) => (n == null ? "—" : nf.format(n));

// Missing price is never shown as 0.
export const fmtMoney = (v?: number | null) => (v == null ? "—" : `Rs. ${mf.format(v)}`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export function fmtDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtRelative(iso?: string | null) {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDateTime(iso).split(",")[0];
}

export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export type RangeKey = "today" | "7d" | "30d" | "month" | "all";
export const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "month", label: "This month" },
];

// Business day follows Nepal time (UTC+05:45, no DST) regardless of the device's timezone.
const NPT_OFFSET_MS = 345 * 60000;
function businessToday() {
  const n = new Date(Date.now() + NPT_OFFSET_MS);
  return new Date(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
}

export function rangeDates(key: RangeKey): { from?: string; to?: string } {
  const today = businessToday();
  if (key === "all") return {};
  if (key === "today") return { from: ymd(today), to: ymd(today) };
  if (key === "month") return { from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: ymd(today) };
  const days = key === "7d" ? 6 : 29;
  return { from: ymd(new Date(today.getTime() - days * 86400000)), to: ymd(today) };
}

export const TXN_LABELS: Record<string, string> = {
  SALE: "Sale",
  STOCK_IN: "Stock in",
  STOCK_REMOVAL: "Removal",
  ADJUSTMENT: "Adjustment",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
  CORRECTION: "Correction",
};

export const REMOVAL_REASONS = [
  { code: "DAMAGED", label: "Damaged stock" },
  { code: "EXPIRED", label: "Expired stock" },
  { code: "COUNT_DISCREPANCY", label: "Physical count discrepancy" },
  { code: "LOST", label: "Lost stock" },
  { code: "RETURNED_TO_SUPPLIER", label: "Returned to supplier" },
  { code: "OTHER", label: "Other" },
];

export const ADJUST_REASONS = [
  { code: "COUNT_DISCREPANCY", label: "Physical count discrepancy" },
  { code: "DAMAGED", label: "Damaged" },
  { code: "EXPIRED", label: "Expired" },
  { code: "LOST", label: "Lost" },
  { code: "FOUND", label: "Found stock" },
  { code: "DATA_ENTRY_ERROR", label: "Data entry error" },
  { code: "OTHER", label: "Other" },
];
