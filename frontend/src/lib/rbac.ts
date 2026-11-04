import { Role } from '../types';

export type AppArea =
  | 'pos' | 'fulfillment' | 'assistant' | 'registers' | 'dashboard' | 'administration' | 'approvals'
  | 'products' | 'inventory' | 'sales' | 'customers' | 'purchases'
  | 'reports' | 'staff' | 'shifts' | 'settings' | 'platform' | 'scan';

const access: Record<AppArea, Role[]> = {
  pos: ['owner', 'manager', 'cashier'],
  fulfillment: ['owner', 'manager', 'delivery_staff'],
  assistant: ['owner', 'manager', 'cashier', 'inventory_manager'],
  registers: ['owner', 'manager'],
  dashboard: ['owner', 'manager'],
  administration: ['admin'],
  approvals: ['owner', 'manager'],
  products: ['owner', 'inventory_manager'],
  inventory: ['owner', 'inventory_manager'],
  sales: ['owner', 'manager'],
  customers: ['owner', 'manager', 'cashier'],
  purchases: ['owner', 'purchase_manager'],
  reports: ['owner', 'accountant'],
  staff: ['owner', 'admin'],
  shifts: ['owner', 'manager', 'cashier'],
  settings: ['owner', 'admin'],
  platform: ['super_admin'],
  // Barcode scan page; the /api/v1/scans endpoints enforce the same roles.
  scan: ['super_admin', 'cashier'],
};

export const canAccess = (role: Role | undefined, area: AppArea) =>
  Boolean(role && access[area].includes(role));

export const homeForRole = (role: Role | undefined) => {
  switch (role) {
    case 'super_admin': return '/platform';
    case 'admin': return '/admin/administration';
    case 'owner':
    case 'manager': return '/admin';
    case 'inventory_manager': return '/admin/inventory';
    case 'purchase_manager': return '/admin/suppliers';
    case 'accountant': return '/admin/reports';
    case 'delivery_staff': return '/fulfillment';
    case 'cashier': return '/pos';
    default: return '/assistant';
  }
};

