export type Role = "owner" | "employee";
export type StockStatus = "ok" | "low" | "out";

export interface User {
  id: string;
  username: string;
  full_name: string;
  role: Role;
  phone?: string | null;
  warehouse_ids: string[];
  active: boolean;
  must_change_password: boolean;
  created_at?: string;
  last_login_at?: string | null;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  address?: string | null;
  phone?: string | null;
  active: boolean;
}

export interface Me {
  user: User;
  warehouses: Warehouse[];
}

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  ancestors: string[];
  depth: number;
  active: boolean;
}

export interface InventoryBrief {
  warehouse_id: string;
  warehouse_name?: string | null;
  quantity: number;
  min_stock?: number | null;
  effective_min: number;
  stock_status?: StockStatus | null;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category_id?: string | null;
  category_ids: string[];
  brand?: string | null;
  description?: string | null;
  unit: string;
  barcode?: string | null;
  supplier?: string | null;
  purchase_price?: number | null;
  selling_price?: number | null;
  min_stock: number;
  batch_no?: string | null;
  expiry_date?: string | null;
  active: boolean;
  stock_total?: number | null;
  stock_status?: StockStatus | null;
  inventory?: InventoryBrief[] | null;
  updated_at?: string;
}

export interface InventoryRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  warehouse_name?: string | null;
  product_name: string;
  sku: string;
  barcode?: string | null;
  unit?: string | null;
  quantity: number;
  min_stock?: number | null;
  product_min_stock: number;
  stock_status?: StockStatus | null;
  purchase_price?: number | null;
  selling_price?: number | null;
  last_sale_at?: string | null;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  tax_id?: string | null;
  active: boolean;
  created_at?: string;
}

export interface Txn {
  id: string;
  txn_no: string;
  type: string;
  product_id: string;
  product_name: string;
  sku?: string | null;
  unit?: string | null;
  warehouse_id: string;
  warehouse_name?: string | null;
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  user_id: string;
  user_name?: string | null;
  user_role?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  unit_price?: number | null;
  unit_cost?: number | null;
  total_amount?: number | null;
  total_cost?: number | null;
  profit?: number | null;
  sales_qty?: number | null;
  reason_code?: string | null;
  reason_note?: string | null;
  note?: string | null;
  transfer_id?: string | null;
  counterpart_warehouse_name?: string | null;
  corrects_txn_id?: string | null;
  corrects_txn_no?: string | null;
  original_type?: string | null;
  created_at: string;
}

export interface StockResult {
  transaction: Txn;
  related: Txn[];
  transfer_id?: string | null;
  idempotent_replay: boolean;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  transaction_id?: string | null;
  product_id?: string | null;
  warehouse_id?: string | null;
  meta?: Record<string, any> | null;
  read: boolean;
  read_at?: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  user_name?: string | null;
  role?: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  before?: any;
  after?: any;
  reason?: string | null;
  meta?: any;
  ip?: string | null;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface SalesRow {
  units: number;
  txns: number;
  revenue: number | null;
  cost: number | null;
  profit: number | null;
  unpriced_units: number;
  profit_unavailable_units: number;
}
