export type Role =
  | 'super_admin'
  | 'admin'
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'inventory_manager'
  | 'purchase_manager'
  | 'accountant'
  | 'delivery_staff'
  | 'waiter'
  | 'kitchen';

export interface User {
  id: string;
  restaurant_id?: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  discount_limit_pct: number;
  is_active: boolean;
  last_login_at?: string;
}

export interface Restaurant {
  id: string;
  name: string;
  slug: string;
  phone?: string;
  email?: string;
  address?: string;
  logo_url?: string;
  currency: string;
  timezone: string;
  language: string;
  tax_no?: string;
  status: string;
}

export interface Branch {
  id: string;
  restaurant_id: string;
  name: string;
  address?: string;
  phone?: string;
  is_active: boolean;
  invoice_prefix: string;
}

export interface Category {
  id: string;
  restaurant_id: string;
  name_en: string;
  name_bn?: string;
  sort: number;
  color?: string;
  station_id?: string;
  is_active: boolean;
}

export interface ItemVariant {
  id: string;
  item_id: string;
  name: string;
  price_minor: number;
  sku?: string;
}

export interface Addon {
  id: string;
  group_id: string;
  name: string;
  price_minor: number;
}

export interface AddonGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  addons?: Addon[];
}

export interface ProductBatch {
  id: string;
  batch_no: string;
  exp_date: string;
  quantity: number;
  cost_price_minor: number;
}

// MenuItem represents a retail Super Shop product
export interface MenuItem {
  id: string;
  restaurant_id: string;
  category_id: string;
  category_name?: string;
  name_en: string;
  name_bn?: string;
  sku?: string;
  brand?: string;
  unit?: string;
  package_size?: string;
  base_price_minor: number;
  regular_price_minor?: number;
  cost_price_minor?: number;
  tax_class: string;
  image_url?: string;
  is_available: boolean;
  is_active: boolean;
  is_weighted?: boolean;
  is_hot_deal?: boolean;
  is_popular?: boolean;
  is_new_arrival?: boolean;
  track_stock?: boolean;
  stock_quantity?: number;
  reorder_level?: number;
  barcode?: string;
  shelf_location?: string;
  department?: string;
  barcodes?: string[];
  batches?: ProductBatch[];
  variants?: ItemVariant[];
  addon_groups?: AddonGroup[];
}

// Alias for clean retail terminology
export type Product = MenuItem;

export interface TableSection {
  id: string;
  restaurant_id: string;
  branch_id: string;
  name: string;
  sort: number;
}

// Table represents a Checkout Register / Cash Counter
export interface Table {
  id: string;
  restaurant_id: string;
  branch_id: string;
  section_id?: string;
  section_name?: string;
  name: string;
  seats: number;
  pos_x: number;
  pos_y: number;
  status: 'free' | 'occupied' | 'bill_requested' | 'cleaning' | 'reserved';
  current_order_id?: string;
}

export type Register = Table;

export interface OrderItemAddon {
  id: string;
  order_item_id: string;
  addon_id?: string;
  name_snapshot: string;
  price_minor: number;
  qty: number;
}

export interface OrderItem {
  id: string;
  restaurant_id: string;
  order_id: string;
  item_id?: string;
  variant_id?: string;
  name_snapshot: string;
  qty: number;
  unit_price_minor: number;
  discount_minor: number;
  tax_minor: number;
  cost_minor_snapshot: number;
  note?: string;
  status: 'pending' | 'preparing' | 'ready' | 'served' | 'cancelled';
  kot_id?: string;
  addons?: OrderItemAddon[];
  created_at: string;
}

export interface Payment {
  id: string;
  order_id: string;
  method_code: string;
  amount_minor: number;
  reference?: string;
  received_by?: string;
  shift_id?: string;
  paid_at: string;
}

export interface Order {
  id: string;
  restaurant_id: string;
  branch_id: string;
  order_no: number;
  token_no?: number;
  type: 'walk_in' | 'pickup' | 'delivery' | 'dine_in' | 'takeaway';
  table_id?: string;
  table_name?: string;
  customer_id?: string;
  customer_name?: string;
  waiter_id?: string;
  waiter_name?: string;
  status: 'draft' | 'placed' | 'in_progress' | 'served' | 'billed' | 'paid' | 'cancelled' | 'refunded';
  subtotal_minor: number;
  discount_minor: number;
  loyalty_points_redeemed: number;
  loyalty_discount_minor: number;
  loyalty_points_earned: number;
  service_charge_minor: number;
  tax_minor: number;
  delivery_fee_minor: number;
  round_off_minor: number;
  total_minor: number;
  paid_minor: number;
  notes?: string;
  shift_id?: string;
  items?: OrderItem[];
  payments?: Payment[];
  opened_at: string;
  closed_at?: string;
}

export interface Customer {
  id: string;
  restaurant_id?: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  customer_group?: string;
  loyalty_points: number;
  credit_limit_minor: number;
  balance_minor: number;
}

export interface Promotion {
  id: string;
  code: string;
  name: string;
  type: 'percentage' | 'fixed';
  discount_pct: number;
  discount_minor: number;
  min_spend_minor: number;
  is_active: boolean;
}

export interface RetailDelivery {
  id: string;
  restaurant_id?: string;
  branch_id?: string;
  order_id: string;
  order_no?: number;
  customer_id?: string;
  recipient_name: string;
  recipient_phone: string;
  delivery_address: string;
  delivery_zone?: string;
  delivery_fee_minor: number;
  status: 'ordered' | 'picking' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled';
  staff_id?: string;
  staff_name?: string;
  notes?: string;
  created_at: string;
}

export interface StockAdjustment {
  id: string;
  restaurant_id?: string;
  branch_id?: string;
  product_id: string;
  product_name?: string;
  type: string;
  qty_change: number;
  reason?: string;
  created_at: string;
}

export interface Supplier {
  id: string;
  restaurant_id?: string;
  name: string;
  phone?: string;
  balance_minor: number;
  created_at?: string;
}

export interface Shift {
  id: string;
  restaurant_id: string;
  branch_id: string;
  cashier_id: string;
  cashier_name?: string;
  terminal_id: string;
  opened_at: string;
  closed_at?: string;
  opening_cash_minor: number;
  expected_cash_minor: number;
  counted_cash_minor: number;
  variance_minor: number;
  note?: string;
  status: 'open' | 'closed';
}

export interface InventoryItem {
  id: string;
  restaurant_id: string;
  name: string;
  unit: string;
  min_level: number;
  category: string;
  avg_cost_minor: number;
  current_stock?: number;
}

export interface Recipe {
  id: string;
  menu_item_id: string;
  inventory_item_id: string;
  item_name?: string;
  unit?: string;
  qty_per_portion: number;
  waste_pct: number;
}

export interface Expense {
  id: string;
  restaurant_id: string;
  branch_id: string;
  category: string;
  amount_minor: number;
  date: string;
  note?: string;
}

export interface PaymentMethod {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
  requires_reference: boolean;
}

export interface AuditLog {
  id: string;
  user_name?: string;
  action: string;
  entity: string;
  entity_id?: string;
  before?: any;
  after?: any;
  created_at: string;
}

export interface ScanLogEntry {
  id: string;
  branch_id: string | null;
  user_id: string | null;
  user_name: string;
  code: string;
  format: string;
  product_id: string | null;
  product_name: string | null;
  price_minor: number | null;
  found: boolean;
  scanned_at: string;
}
