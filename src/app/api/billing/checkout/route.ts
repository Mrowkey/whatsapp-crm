// ============================================================
// POST /api/billing/checkout — start a subscription. Admin+.
//
// Body: { "plan": "starter" | "growth" }
// Returns { url } — the provider's hosted checkout page. The
// subscription itself is recorded by the webhook, not here: the
// browser coming back from checkout proves nothing about payment.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { appUrl } from "@/lib/billing/app-url";
import { getBillingProvider } from "@/lib/billing/get-provider";
import { isPaidPlanId, priceIdForPlan } from "@/lib/billing/plans";
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
      `admin:billingCheckout:${ctx.userId}`,
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

    const body = (await request.json().catch(() => null)) as
      | { plan?: unknown }
      | null;
    const plan = body?.plan;
    if (!isPaidPlanId(plan)) {
      return NextResponse.json(
        { error: "'plan' must be one of starter, growth" },
        { status: 400 },
      );
    }

    const priceId = priceIdForPlan(plan);
    if (!priceId) {
      return NextResponse.json(
        { error: "This plan is not available for purchase yet" },
        { status: 503 },
      );
    }

    const sub = await loadSubscription(supabaseAdmin(), ctx.accountId);

    // A second checkout on top of a live subscription would bill the
    // customer twice. Plan changes go through the billing portal.
    if (
      sub?.provider_subscription_id &&
      (sub.status === "active" || sub.status === "past_due")
    ) {
      return NextResponse.json(
        {
          error:
            "This workspace already has a subscription. Use Manage billing to change plan.",
        },
        { status: 409 },
      );
    }

    const {
      data: { user },
    } = await ctx.supabase.auth.getUser();

    const base = appUrl(request);
    const { url } = await provider.createCheckoutSession({
      accountId: ctx.accountId,
      plan,
      priceId,
      customerId: sub?.provider_customer_id ?? null,
      customerEmail: user?.email ?? null,
      successUrl: `${base}/settings?tab=billing&checkout=success`,
      cancelUrl: `${base}/settings?tab=billing&checkout=canceled`,
    });

    return NextResponse.json({ url });
  } catch (err) {
    if (err instanceof ProviderError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return toErrorResponse(err);
  }
}
