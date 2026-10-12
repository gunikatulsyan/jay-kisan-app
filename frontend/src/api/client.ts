// Single API client. Talks ONLY to the FastAPI backend (never to MongoDB).
// Access token (30 min) + rotating refresh token, both in secure device storage.
import { storage } from "@/src/utils/storage";

export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;
const BASE = `${BACKEND_URL}/api/v1`;
const ACCESS_KEY = "jk.access_token";
const REFRESH_KEY = "jk.refresh_token";

let accessToken: string | null = null;
let refreshToken: string | null = null;
let authLost: (() => void) | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  status: number;
  code: string;
  details: any;
  constructor(status: number, code: string, message: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const NETWORK_MESSAGE = "No internet connection. Please check your network and try again.";

export function setAuthLostHandler(fn: () => void) {
  authLost = fn;
}

export function getAccessToken() {
  return accessToken;
}

export async function loadTokens(): Promise<boolean> {
  accessToken = await storage.secureGet(ACCESS_KEY, null);
  refreshToken = await storage.secureGet(REFRESH_KEY, null);
  return !!refreshToken;
}

export async function saveTokens(access: string, refresh: string) {
  accessToken = access;
  refreshToken = refresh;
  await storage.secureSet(ACCESS_KEY, access);
  await storage.secureSet(REFRESH_KEY, refresh);
}

export async function clearTokens() {
  accessToken = null;
  refreshToken = null;
  await storage.secureRemove(ACCESS_KEY);
  await storage.secureRemove(REFRESH_KEY);
}

export function getRefreshToken() {
  return refreshToken;
}

export async function refreshSession(): Promise<boolean> {
  if (!refreshToken) return false;
  if (!refreshing) {
    const token = refreshToken;
    refreshing = (async () => {
      try {
        const r = await fetch(`${BASE}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: token }),
        });
        if (!r.ok) return false;
        const j = await r.json();
        await saveTokens(j.access_token, j.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        setTimeout(() => (refreshing = null), 0);
      }
    })();
  }
  return refreshing;
}

type Opts = { method?: string; body?: any; idempotencyKey?: string; form?: FormData; auth?: boolean };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const exec = () => {
    const headers: Record<string, string> = {};
    if (!opts.form) headers["Content-Type"] = "application/json";
    if (accessToken && opts.auth !== false) headers.Authorization = `Bearer ${accessToken}`;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    return fetch(`${BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  };
  let res: Response;
  try {
    res = await exec();
    if (res.status === 401 && opts.auth !== false && refreshToken) {
      if (await refreshSession()) {
        res = await exec();
      } else {
        await clearTokens();
        authLost?.();
      }
    }
  } catch {
    throw new ApiError(0, "NETWORK", NETWORK_MESSAGE);
  }
  if (!res.ok) {
    let j: any = null;
    try {
      j = await res.json();
    } catch {}
    const e = j?.error;
    throw new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? "Request failed. Please try again.", e?.details);
  }
  if (res.status === 204) return null as T;
  return res.json();
}

export function newIdempotencyKey() {
  const r = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${r()}-${r()}`;
}

export function qs(params: Record<string, any>) {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== "all")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return "Something went wrong. Please try again.";
}
