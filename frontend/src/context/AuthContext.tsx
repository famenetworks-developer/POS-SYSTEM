import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Restaurant, Branch } from '../types';
import { api } from '../lib/api';
import { wsHub } from '../lib/ws';
import { cacheBootstrapData } from '../offline/sync';

interface AuthContextType {
  user: User | null;
  restaurant: Restaurant | null;
  branches: Branch[];
  activeBranch: Branch | null;
  setActiveBranch: (b: Branch) => void;
  login: (email: string, pass: string) => Promise<User>;
  pinLogin: (branchId: string, pin: string) => Promise<User>;
  logout: () => void;
  impersonate: (restId: string) => Promise<void>;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranch, setActiveBranchState] = useState<Branch | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const setActiveBranch = (b: Branch) => {
    setActiveBranchState(b);
    localStorage.setItem('restoflow_branch_id', b.id);
    wsHub.connect(b.id);
    cacheBootstrapData(b.id);
  };

  const loadMe = async () => {
    try {
      const res = await api.get('/me');
      if (res?.user) {
        setUser(res.user);
        if (res.restaurant) {
          setRestaurant(res.restaurant);
        }

        // Fetch branches
        try {
          const brList = await api.get('/branches');
          if (Array.isArray(brList) && brList.length > 0) {
            setBranches(brList);
            const savedBranchId = localStorage.getItem('restoflow_branch_id');
            const found = brList.find((b: Branch) => b.id === savedBranchId) || brList[0];
            setActiveBranchState(found);
            wsHub.connect(found.id);
            cacheBootstrapData(found.id);
          }
        } catch (e) {
          console.warn('Could not load branches:', e);
        }
      }
    } catch (e) {
      localStorage.removeItem('restoflow_token');
      localStorage.removeItem('restoflow_refresh_token');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('restoflow_token');
    if (token) {
      loadMe();
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = async (email: string, pass: string) => {
    const res = await api.post('/auth/login', { email, password: pass });
    localStorage.setItem('restoflow_token', res.access_token);
    localStorage.setItem('restoflow_refresh_token', res.refresh_token);
    setUser(res.user);
    if (res.restaurant) {
      setRestaurant(res.restaurant);
    }
    if (res.branches && res.branches.length > 0) {
      setBranches(res.branches);
      setActiveBranchState(res.branches[0]);
      localStorage.setItem('restoflow_branch_id', res.branches[0].id);
      wsHub.connect(res.branches[0].id);
      cacheBootstrapData(res.branches[0].id);
    }
    return res.user as User;
  };

  const pinLogin = async (branchId: string, pin: string) => {
    const res = await api.post('/auth/pin-login', { branch_id: branchId, pin });
    localStorage.setItem('restoflow_token', res.access_token);
    localStorage.setItem('restoflow_refresh_token', res.refresh_token);
    setUser(res.user);
    await loadMe();
    return res.user as User;
  };

  const logout = () => {
    const rt = localStorage.getItem('restoflow_refresh_token');
    if (rt) {
      api.post('/auth/logout', { refresh_token: rt }).catch(() => {});
    }
    localStorage.removeItem('restoflow_token');
    localStorage.removeItem('restoflow_refresh_token');
    setUser(null);
    setRestaurant(null);
    wsHub.disconnect();
  };

  const impersonate = async (restId: string) => {
    const res = await api.post(`/admin/restaurants/${restId}/impersonate`);
    localStorage.setItem('restoflow_token', res.access_token);
    localStorage.setItem('restoflow_refresh_token', res.refresh_token);
    setUser(res.user);
    await loadMe();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        restaurant,
        branches,
        activeBranch,
        setActiveBranch,
        login,
        pinLogin,
        logout,
        impersonate,
        isLoading,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
