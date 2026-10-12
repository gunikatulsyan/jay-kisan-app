import { router } from "expo-router";
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

import { api, ApiError, clearTokens, getRefreshToken, loadTokens, saveTokens, setAuthLostHandler } from "@/src/api/client";
import type { Me } from "@/src/api/types";
import { queryClient } from "@/src/query-client";

type AuthState = {
  ready: boolean;
  me: Me | null;
  bootError: string | null;
  login: (username: string, password: string) => Promise<Me>;
  logout: (allDevices?: boolean) => Promise<void>;
  refreshMe: () => Promise<Me | null>;
  applyTokens: (t: { access_token: string; refresh_token: string }) => Promise<Me>;
  retryBoot: () => void;
};

const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

export function homeFor(me: Me | null): "/login" | "/change-password" | "/dashboard" | "/home" {
  if (!me) return "/login";
  if (me.user.must_change_password) return "/change-password";
  return me.user.role === "owner" ? "/dashboard" : "/home";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootKey, setBootKey] = useState(0);

  useEffect(() => {
    setAuthLostHandler(() => {
      setMe(null);
      queryClient.clear();
      router.replace("/login");
    });
  }, []);

  useEffect(() => {
    (async () => {
      setBootError(null);
      try {
        if (await loadTokens()) setMe(await api<Me>("/auth/me"));
      } catch (e) {
        if (e instanceof ApiError && e.code === "NETWORK") setBootError(e.message);
        else await clearTokens();
      } finally {
        setReady(true);
      }
    })();
  }, [bootKey]);

  const refreshMe = useCallback(async () => {
    try {
      const m = await api<Me>("/auth/me");
      setMe(m);
      return m;
    } catch {
      return null;
    }
  }, []);

  const applyTokens = useCallback(async (t: { access_token: string; refresh_token: string }) => {
    await saveTokens(t.access_token, t.refresh_token);
    const m = await api<Me>("/auth/me");
    setMe(m);
    return m;
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const t = await api<{ access_token: string; refresh_token: string }>("/auth/login", { method: "POST", body: { username, password }, auth: false });
    queryClient.clear();
    return applyTokens(t);
  }, [applyTokens]);

  const logout = useCallback(async (allDevices = false) => {
    try {
      await api(allDevices ? "/auth/logout-all" : "/auth/logout", { method: "POST", body: allDevices ? undefined : { refresh_token: getRefreshToken() } });
    } catch {}
    await clearTokens();
    queryClient.clear();
    setMe(null);
    router.replace("/login");
  }, []);

  return (
    <Ctx.Provider value={{ ready, me, bootError, login, logout, refreshMe, applyTokens, retryBoot: () => { setReady(false); setBootKey((k) => k + 1); } }}>
      {children}
    </Ctx.Provider>
  );
}
