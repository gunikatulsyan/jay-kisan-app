import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";

import type { Warehouse } from "@/src/api/types";
import { useAuth } from "@/src/auth/AuthContext";
import { storage } from "@/src/utils/storage";

type WState = {
  selected: string; // "all" (owner only) or warehouse id
  setSelected: (id: string) => void;
  warehouses: Warehouse[];
  current: Warehouse | null;
  canSelectAll: boolean;
};

const Ctx = createContext<WState>(null as unknown as WState);
export const useWarehouse = () => useContext(Ctx);
const KEY = "jk.selected_warehouse";

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const [selected, setSel] = useState<string>("all");
  const warehouses = useMemo(() => me?.warehouses ?? [], [me]);
  const isOwner = me?.user.role === "owner";

  useEffect(() => {
    if (!me) return;
    (async () => {
      const saved = await storage.getItem(`${KEY}.${me.user.id}`, "");
      const valid = saved && (saved === "all" ? isOwner : warehouses.some((w) => w.id === saved));
      if (valid) setSel(saved as string);
      else setSel(isOwner ? "all" : warehouses[0]?.id ?? "");
    })();
  }, [me, warehouses, isOwner]);

  const setSelected = (id: string) => {
    setSel(id);
    if (me) storage.setItem(`${KEY}.${me.user.id}`, id);
  };

  const current = warehouses.find((w) => w.id === selected) ?? null;
  return <Ctx.Provider value={{ selected, setSelected, warehouses, current, canSelectAll: !!isOwner }}>{children}</Ctx.Provider>;
}
