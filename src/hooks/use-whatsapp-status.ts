"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type WhatsappStatus = "connected" | "disconnected";

/**
 * Whether the account's WhatsApp number is connected, read from the
 * account's `whatsapp_config` row. `null` while the answer is unknown
 * (profile or query still loading) so callers can avoid flashing a
 * "not connected" state at connected users.
 *
 * `whatsapp_config` is one-row-per-account, so this keys on the
 * account id — a teammate who didn't personally save the config still
 * sees the shared number's status.
 */
export function useWhatsappStatus(): WhatsappStatus | null {
  const { accountId, profileLoading } = useAuth();
  // Keyed by account so a stale answer is never shown for another account.
  const [result, setResult] = useState<{
    accountId: string;
    status: WhatsappStatus;
  } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("whatsapp_config")
      .select("status")
      .eq("account_id", accountId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setResult({
          accountId,
          status: data?.status === "connected" ? "connected" : "disconnected",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (profileLoading) return null;
  if (!accountId) return "disconnected";
  return result?.accountId === accountId ? result.status : null;
}
