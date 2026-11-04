import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/ui/Navbar';
import { LoginView } from './features/auth/LoginView';
import { RegisterView } from './features/auth/RegisterView';
import { POSTerminal } from './features/pos/POSTerminal';
import { FulfillmentView } from './features/kds/FulfillmentView';
import { FloorAssistantView } from './features/waiter/FloorAssistantView';
import { AdminLayout } from './features/admin/AdminLayout';
import { AdminDashboard } from './features/admin/AdminDashboard';
import { ProductManager } from './features/admin/ProductManager';
import { RegisterManager } from './features/admin/RegisterManager';
import { InventoryManager } from './features/admin/InventoryManager';
import { SalesManager } from './features/admin/SalesManager';
import { CustomerManager } from './features/admin/CustomerManager';
import { SupplierManager } from './features/admin/SupplierManager';
import { ReportsView } from './features/admin/ReportsView';
import { StaffManager } from './features/admin/StaffManager';
import { ShiftManager } from './features/admin/ShiftManager';
import { SettingsView } from './features/admin/SettingsView';
import { PlatformAdmin } from './features/platform/PlatformAdmin';
import { BarcodeScanView } from './features/scan/BarcodeScanView';
import { SCAN_BARCODE_ROLES } from './lib/access';
import type { Role } from './types';

const ProtectedLayout: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center text-[#0D5C3A] font-bold text-sm gap-2">
        <div className="w-8 h-8 rounded-full border-3 border-[#0D5C3A] border-t-transparent animate-spin" />
        <span>Initializing NovaMart Super Shop POS...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col overflow-x-hidden">
      <Navbar />
      <div className="flex-1 flex flex-col overflow-x-hidden">
        <Outlet />
      </div>
    </div>
  );
};

const RequireRoles: React.FC<{ roles: readonly Role[]; children: React.ReactNode }> = ({ roles, children }) => {
  const { user } = useAuth();

  if (!user || !roles.includes(user.role)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <h1 className="text-lg font-bold text-[#0F172A]">You don't have access to this page</h1>
        <p className="text-sm text-[#64748B]">Ask an administrator if you need access.</p>
      </div>
    );
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Auth Routes */}
          <Route path="/login" element={<LoginView />} />
          <Route path="/register" element={<RegisterView />} />

          {/* Protected Application Routes */}
          <Route element={<ProtectedLayout />}>
            {/* POS Checkout Terminal */}
            <Route path="/pos" element={<POSTerminal />} />

            {/* Order Fulfillment & Delivery Picking */}
            <Route path="/fulfillment" element={<FulfillmentView />} />
            <Route path="/kds" element={<Navigate to="/fulfillment" replace />} />

            {/* Floor Assistant & Price Checker */}
            <Route path="/assistant" element={<FloorAssistantView />} />
            <Route path="/waiter" element={<Navigate to="/assistant" replace />} />

            {/* Barcode lookup (camera, USB scanner or typed code) */}
            <Route path="/scan" element={<RequireRoles roles={SCAN_BARCODE_ROLES}><BarcodeScanView /></RequireRoles>} />

            {/* Standalone Registers view */}
            <Route path="/registers" element={<RegisterManager />} />
            <Route path="/tables" element={<Navigate to="/registers" replace />} />

            {/* Back Office Admin Routes */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminDashboard />} />
              <Route path="products" element={<ProductManager />} />
              <Route path="menu" element={<Navigate to="/admin/products" replace />} />
              <Route path="registers" element={<RegisterManager />} />
              <Route path="tables" element={<Navigate to="/admin/registers" replace />} />
              <Route path="inventory" element={<InventoryManager />} />
              <Route path="sales" element={<SalesManager />} />
              <Route path="customers" element={<CustomerManager />} />
              <Route path="suppliers" element={<SupplierManager />} />
              <Route path="reports" element={<ReportsView />} />
              <Route path="staff" element={<StaffManager />} />
              <Route path="shifts" element={<ShiftManager />} />
              <Route path="settings" element={<SettingsView />} />
            </Route>

            {/* Super Admin Platform Console */}
            <Route path="/platform" element={<PlatformAdmin />} />

            {/* Default root fallback */}
            <Route path="/" element={<Navigate to="/pos" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/pos" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
