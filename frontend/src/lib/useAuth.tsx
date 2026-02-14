"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, endpoints, setAuthToken } from "./api";

type Role = {
  id: number;
  name: string;
  visibility_role?: string;
};

type User = {
  id: number;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  national_id?: string;
  phone_number?: string;
  is_superuser?: boolean;
  is_staff?: boolean;
  roles?: Role[];
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => void;
  register: (payload: Record<string, string>) => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("pcms_token");
    if (saved) {
      setAuthToken(saved);
      setToken(saved);
      api
        .get(endpoints.me)
        .then((res) => setUser(res.data))
        .catch(() => logout())
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (identifier: string, password: string) => {
    const res = await api.post(endpoints.login, { identifier, password });
    const tok = res.data?.tokens?.access;
    if (tok) {
      localStorage.setItem("pcms_token", tok);
      setAuthToken(tok);
      setToken(tok);
      const me = await api.get(endpoints.me);
      setUser(me.data);
    }
  };

  const register = async (payload: Record<string, string>) => {
    await api.post(endpoints.register, payload);
  };

  const logout = () => {
    localStorage.removeItem("pcms_token");
    setAuthToken(undefined);
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};
