import type { Role } from '../types';

// Roles allowed to open the barcode scan page (/scan). The header button and the route guard both use this.
export const SCAN_BARCODE_ROLES: readonly Role[] = ['super_admin', 'cashier'];
