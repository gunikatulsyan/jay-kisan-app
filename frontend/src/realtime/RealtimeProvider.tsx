// WebSocket real-time layer. MongoDB (via REST) stays authoritative: on every (re)connect we
// invalidate cached queries so the UI re-syncs; missed events are never assumed.
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ReactNode, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { api, BACKEND_URL, getAccessToken, refreshSession } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { useToast } from "@/src/components/Toast";
import { queryClient } from "@/src/query-client";

const WS_URL = `${BACKEND_URL.replace(/^http/, "ws")}/api/v1/ws`;

export function useUnreadCount() {
  const { me } = useAuth();
  const q = useQuery({
    queryKey: ["unread"],
    queryFn: () => api<{ count: number }>("/notifications/unread-count"),
    enabled: !!me && !me.user.must_change_password,
    refetchInterval: 60000, // REST fallback if the socket is down
  });
  return q.data?.count ?? 0;
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const toast = useToast();
  const userId = me && !me.user.must_change_password ? me.user.id : null;
  const isOwner = me?.user.role === "owner";
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    let attempt = 0;
    let ping: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const resync = () => {
      ["inventory", "products", "product", "dashboard", "transactions", "notifications", "unread"].forEach((k) =>
        queryClient.invalidateQueries({ queryKey: [k] }),
      );
    };

    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", token: getAccessToken() }));
      ws.onmessage = (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        if (msg.type === "ready") {
          if (attempt > 0) resync();
          attempt = 0;
          if (ping) clearInterval(ping);
          ping = setInterval(() => ws.readyState === 1 && ws.send('{"type":"ping"}'), 25000);
        } else if (msg.type === "notification") {
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
          queryClient.invalidateQueries({ queryKey: ["unread"] });
          const n = msg.data;
          if (isOwner) {
            const extra = n.meta?.warehouse_name ? ` · ${n.meta.warehouse_name}${n.meta.sold_to ? ` · Sold to ${n.meta.sold_to}` : ""}` : "";
            toast.show({
              title: n.title, message: `${n.message}${extra}`, tone: n.type === "SALE" ? "info" : "error",
              actionLabel: n.transaction_id ? "View" : undefined,
              onAction: n.transaction_id ? () => router.push(`/transaction/${n.transaction_id}`) : undefined,
            });
          }
        } else if (msg.type === "inventory") {
          ["inventory", "products", "product", "dashboard"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
        } else if (msg.type === "transaction") {
          ["transactions", "dashboard", "sales"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
        }
      };
      ws.onclose = async (ev) => {
        if (ping) clearInterval(ping);
        if (stopped) return;
        if (ev.code === 4001 || ev.code === 4401) await refreshSession();
        attempt += 1;
        retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempt, 5)));
      };
      ws.onerror = () => ws.close();
    };

    connect();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") {
        resync();
        if (!wsRef.current || wsRef.current.readyState > 1) {
          if (retry) clearTimeout(retry);
          connect();
        }
      }
    });
    return () => {
      stopped = true;
      sub.remove();
      if (ping) clearInterval(ping);
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [userId, isOwner, toast]);

  return <>{children}</>;
}
