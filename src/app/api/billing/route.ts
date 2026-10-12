// ============================================================
// GET /api/billing — the caller's account plan, status and usage.
//
// Any member may read it: agents and viewers need to know why sending
// is blocked, and the shell's upgrade banner is shown to everyone.
// Managing billing (checkout / portal) is admin+ and lives in the
// sibling routes.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canEditSettings } from "@/lib/auth/roles";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { resolveAccess } from "@/lib/billing/entitlements";
import { getBillingProvider } from "@/lib/billing/get-provider";
import { isBillingEnforced } from "@/lib/billing/guard";
import { PAID_PLAN_IDS, priceIdForPlan } from "@/lib/billing/plans";
import { loadSubscription, loadUsage } from "@/lib/billing/store";
import type { BillingSummary } from "@/lib/billing/summary";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const enforced = isBillingEnforced();
    // Usage must be counted account-wide, which needs the service role
    // (an agent can't see pending invitations under RLS). When billing
    // isn't enforced the numbers are informational, so the caller's own
    // client will do — and a deployment that never set billing up isn't
    // made to depend on the service-role key for every page load.
    const db = enforced ? supabaseAdmin() : ctx.supabase;

    const [sub, usage] = await Promise.all([
      loadSubscription(db, ctx.accountId).catch((err) => {
        console.error("[GET /api/billing] subscription load error:", err);
        return null;
      }),
      loadUsage(db, ctx.accountId),
    ]);

    const access = resolveAccess(sub, { enforced });

    const summary: BillingSummary = {
      configured: getBillingProvider() !== null,
      enforced,
      canManage: canEditSettings(ctx.role),
      plan: access.plan,
      state: access.state,
      canWrite: access.canWrite,
      limits: access.limits,
      usage,
      trialEndsAt: sub?.trial_ends_at ?? null,
      trialDaysLeft: access.trialDaysLeft,
      currentPeriodEnd: sub?.current_period_end ?? null,
      cancelAtPeriodEnd: sub?.cancel_at_period_end ?? false,
      hasPaidSubscription:
        !!sub?.provider_subscription_id &&
        (sub.status === "active" || sub.status === "past_due"),
      hasCustomer: !!sub?.provider_customer_id,
      purchasablePlans: PAID_PLAN_IDS.filter((id) => !!priceIdForPlan(id)),
    };

    return NextResponse.json(summary);
  } catch (err) {
    return toErrorResponse(err);
  }
}
