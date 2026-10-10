"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { BillingSummary } from "@/lib/billing/summary";

interface BillingContextValue {
  /** Null until the first load finishes, or if it failed. */
  billing: BillingSummary | null;
  loading: boolean;
  /** Re-read plan + usage, e.g. after returning from checkout. */
  refresh: () => Promise<BillingSummary | null>;
}

const BillingContext = createContext<BillingContextValue>({
  billing: null,
  loading: false,
  refresh: async () => null,
});

async function fetchBilling(): Promise<BillingSummary | null> {
  try {
    const res = await fetch("/api/billing", { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as BillingSummary;
  } catch {
    return null;
  }
}

/**
 * Loads the account's plan once for the dashboard shell so the upgrade
 * banner, the Billing tab and inline hints share one request.
 *
 * A failed load leaves `billing` null and every consumer treats null as
 * "no restrictions known" — the server is what actually enforces.
 */
export function BillingProvider({ children }: { children: ReactNode }) {
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const next = await fetchBilling();
    setBilling(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchBilling().then((next) => {
      if (cancelled) return;
      setBilling(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ billing, loading, refresh }),
    [billing, loading, refresh],
  );

  return (
    <BillingContext.Provider value={value}>{children}</BillingContext.Provider>
  );
}

export function useBilling(): BillingContextValue {
  return useContext(BillingContext);
}
