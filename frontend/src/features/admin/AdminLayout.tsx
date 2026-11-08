import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { AppArea, canAccess } from '../../lib/rbac';
import {
  LayoutDashboard,
  Package,
  LayoutGrid,
  Boxes,
  Receipt,
  Users,
  Truck,
  LineChart,
  UserCheck,
  Clock,
  Settings,
  ShoppingBag,
  ShieldCheck,
} from 'lucide-react';

export const AdminLayout: React.FC = () => {
  const { user } = useAuth();
  const allTabs: Array<{ to: string; label: string; icon: React.ElementType; area: AppArea; end?: boolean }> = [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, area: 'dashboard', end: true },
    { to: '/admin/administration', label: 'Administration', icon: LayoutDashboard, area: 'administration' },
    { to: '/admin/approvals', label: 'Approval Queue', icon: ShieldCheck, area: 'approvals' },
    { to: '/admin/products', label: 'Products & Catalogue', icon: Package, area: 'products' },
    { to: '/admin/registers', label: 'Registers & Counters', icon: LayoutGrid, area: 'registers' },
    { to: '/admin/inventory', label: 'Inventory & Stock', icon: Boxes, area: 'inventory' },
    { to: '/admin/sales', label: 'Sales & Invoices', icon: Receipt, area: 'sales' },
    { to: '/admin/customers', label: 'Customers & Loyalty', icon: Users, area: 'customers' },
    { to: '/admin/suppliers', label: 'Suppliers & Purchases', icon: Truck, area: 'purchases' },
    { to: '/admin/reports', label: 'Financial Reports', icon: LineChart, area: 'reports' },
    { to: '/admin/staff', label: 'Staff & Roles', icon: UserCheck, area: 'staff' },
    { to: '/admin/shifts', label: user?.role === 'cashier' ? 'My Shift' : 'Register Shifts', icon: Clock, area: 'shifts' },
    { to: '/admin/settings', label: user?.role === 'manager' ? 'Store Time Zone' : 'Store Settings', icon: Settings, area: 'settings' },
  ];
  const tabs = allTabs.filter((tab) => canAccess(user?.role, tab.area));

  return (
    <div className="app-content-height flex-1 flex flex-col md:flex-row overflow-hidden bg-[#F8FAFC]">
      {/* Mobile Sub-Navigation Bar (< md) */}
      <div className="md:hidden bg-white border-b border-[#E2E8F0] px-3 py-2 flex items-center gap-1.5 overflow-x-auto shrink-0 select-none shadow-sm">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all min-h-[44px] ${
                  isActive
                    ? 'bg-[#0D5C3A] text-white shadow-sm'
                    : 'text-[#475569] hover:text-[#0D5C3A] bg-[#F1F5F9]'
                }`
              }
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </NavLink>
          );
        })}
      </div>

      {/* Desktop Sidebar (>= md) */}
      <aside className="hidden md:flex w-60 lg:w-64 bg-white border-r border-[#E2E8F0] flex-col shrink-0 select-none shadow-sm">
        <div className="p-4 border-b border-[#E2E8F0] flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#E6F4EA] text-[#0D5C3A] flex items-center justify-center font-bold">
            <ShoppingBag className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-[10px] font-black tracking-wider uppercase text-[#64748B]">Back Office</h2>
            <p className="text-xs font-extrabold text-[#0D5C3A]">Super Shop Management</p>
          </div>
        </div>

        <nav className="p-3 space-y-1 flex-1 overflow-y-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                    isActive
                      ? 'bg-[#0D5C3A] text-white shadow-sm'
                      : 'text-[#475569] hover:text-[#0D5C3A] hover:bg-[#F1F5F9]'
                  }`
                }
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-3 sm:p-6 lg:p-8 bg-[#F8FAFC] overscroll-contain">
        <Outlet />
      </main>
    </div>
  );
};
