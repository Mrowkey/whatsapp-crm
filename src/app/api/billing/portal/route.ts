// ============================================================
// POST /api/billing/portal — open the provider's billing portal
// (change plan, update card, cancel, invoices). Admin+.
//
// Returns { url }.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { appUrl } from "@/lib/billing/app-url";
import { getBillingProvider } from "@/lib/billing/get-provider";
import { ProviderError } from "@/lib/billing/provider";
import { loadSubscription } from "@/lib/billing/store";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:billingPortal:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const provider = getBillingProvider();
    if (!provider) {
      return NextResponse.json(
        { error: "Billing is not configured on this deployment" },
        { status: 503 },
      );
    }

    const sub = await loadSubscription(supabaseAdmin(), ctx.accountId);
    if (!sub?.provider_customer_id) {
      return NextResponse.json(
        {
          error:
            "This workspace has no billing account yet. Choose a plan first.",
        },
        { status: 409 },
      );
    }

    const { url } = await provider.createPortalSession({
      customerId: sub.provider_customer_id,
      returnUrl: `${appUrl(request)}/settings?tab=billing`,
    });

    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof ProviderError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
