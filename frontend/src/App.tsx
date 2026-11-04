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
import { AppArea, canAccess, homeForRole } from './lib/rbac';

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

const RoleRoute: React.FC<{ area: AppArea; children: React.ReactNode }> = ({ area, children }) => {
  const { user } = useAuth();
  return canAccess(user?.role, area) ? <>{children}</> : <Navigate to={homeForRole(user?.role)} replace />;
};

const HomeRoute: React.FC = () => {
  const { user } = useAuth();
  return <Navigate to={homeForRole(user?.role)} replace />;
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
            <Route path="/pos" element={<RoleRoute area="pos"><POSTerminal /></RoleRoute>} />

            {/* Order Fulfillment & Delivery Picking */}
            <Route path="/fulfillment" element={<RoleRoute area="fulfillment"><FulfillmentView /></RoleRoute>} />
            <Route path="/kds" element={<Navigate to="/fulfillment" replace />} />

            {/* Floor Assistant & Price Checker */}
            <Route path="/assistant" element={<RoleRoute area="assistant"><FloorAssistantView /></RoleRoute>} />
            <Route path="/waiter" element={<Navigate to="/assistant" replace />} />

            {/* Standalone Registers view */}
            <Route path="/registers" element={<RoleRoute area="registers"><RegisterManager /></RoleRoute>} />
            <Route path="/tables" element={<Navigate to="/registers" replace />} />

            {/* Back Office Admin Routes */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<RoleRoute area="dashboard"><AdminDashboard /></RoleRoute>} />
              <Route path="products" element={<RoleRoute area="products"><ProductManager /></RoleRoute>} />
              <Route path="menu" element={<Navigate to="/admin/products" replace />} />
              <Route path="registers" element={<RoleRoute area="registers"><RegisterManager /></RoleRoute>} />
              <Route path="tables" element={<Navigate to="/admin/registers" replace />} />
              <Route path="inventory" element={<RoleRoute area="inventory"><InventoryManager /></RoleRoute>} />
              <Route path="sales" element={<RoleRoute area="sales"><SalesManager /></RoleRoute>} />
              <Route path="customers" element={<RoleRoute area="customers"><CustomerManager /></RoleRoute>} />
              <Route path="suppliers" element={<RoleRoute area="purchases"><SupplierManager /></RoleRoute>} />
              <Route path="reports" element={<RoleRoute area="reports"><ReportsView /></RoleRoute>} />
              <Route path="staff" element={<RoleRoute area="staff"><StaffManager /></RoleRoute>} />
              <Route path="shifts" element={<RoleRoute area="shifts"><ShiftManager /></RoleRoute>} />
              <Route path="settings" element={<RoleRoute area="settings"><SettingsView /></RoleRoute>} />
            </Route>

            {/* Super Admin Platform Console */}
            <Route path="/platform" element={<RoleRoute area="platform"><PlatformAdmin /></RoleRoute>} />

            {/* Default root fallback */}
            <Route path="/" element={<HomeRoute />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
