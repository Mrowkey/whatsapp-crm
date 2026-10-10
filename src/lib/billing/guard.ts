// ============================================================
// Server-side billing guards — the one place API routes ask "may this
// account do this?".
//
//   await requireWritable(accountId)              // send / edit paths
//   await requireWithinLimit(accountId, 'contacts', n)   // create paths
//   await requireFeature(accountId, 'apiAccess')  // plan-gated features
//
// Each throws a `BillingError` (HTTP 402). `toErrorResponse` (dashboard
// routes) and `toApiErrorResponse` (public API) already map it; routes
// with their own catch use `billingErrorResponse`.
//
// Enforcement is OFF until a payment provider is configured
// (STRIPE_SECRET_KEY). A deployment with no way to pay must not lock
// its users out when a trial lapses, so without a provider every guard
// is a no-op and costs no database round trip.
//
// Infrastructure failures fail OPEN: if the subscription can't be read
// (e.g. migration 034 not applied yet) the action is allowed and the
// error logged. A paying customer is never blocked by our own outage.
//
// Server-only: uses the service-role client.
// ============================================================

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { AUTH_DISABLED } from '@/lib/auth/mode';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  BillingError,
  assertFeature,
  assertLimit,
  assertWritable,
  resolveAccess,
  type Access,
} from './entitlements';
import type { FeatureKey, LimitKey } from './plans';
import { countUsage, loadSubscription, recordBroadcastRecipients } from './store';

/** True when a payment provider is configured and limits apply. */
export function isBillingEnforced(): boolean {
  if (AUTH_DISABLED) return false;
  return !!process.env.STRIPE_SECRET_KEY?.trim();
}

/** Resolve what `accountId` may do right now. Never throws. */
export async function getAccountAccess(
  accountId: string,
  db?: SupabaseClient,
): Promise<Access> {
  // Checked before touching the service-role client, so an unconfigured
  // deployment never constructs one just to be told "no limits".
  if (!isBillingEnforced()) return resolveAccess(null, { enforced: false });
  try {
    const sub = await loadSubscription(db ?? supabaseAdmin(), accountId);
    return resolveAccess(sub, { enforced: true });
  } catch (err) {
    console.error('[billing] could not load subscription; allowing action:', err);
    return resolveAccess(null, { enforced: false });
  }
}

/** Refuse when the workspace is read-only (trial over / subscription ended). */
export async function requireWritable(accountId: string): Promise<Access> {
  const access = await getAccountAccess(accountId);
  assertWritable(access);
  return access;
}

/**
 * Refuse when creating `adding` more of `key` would exceed the plan.
 * Also refuses a read-only workspace.
 */
export async function requireWithinLimit(
  accountId: string,
  key: LimitKey,
  adding = 1,
): Promise<Access> {
  const access = await getAccountAccess(accountId);
  if (!access.enforced) return access;
  assertWritable(access);
  if (access.limits[key] === null) return access;

  let used: number;
  try {
    used = await countUsage(supabaseAdmin(), accountId, key);
  } catch (err) {
    console.error(`[billing] could not count '${key}'; allowing action:`, err);
    return access;
  }
  assertLimit(access, key, used, adding);
  return access;
}

/** Refuse when the plan doesn't include `feature`. */
export async function requireFeature(
  accountId: string,
  feature: FeatureKey,
): Promise<Access> {
  const access = await getAccountAccess(accountId);
  if (access.enforced) assertFeature(access, feature);
  return access;
}

/** Count campaign messages just sent toward this month's allowance. */
export async function recordCampaignSends(
  accountId: string,
  amount: number,
): Promise<void> {
  if (!isBillingEnforced()) return;
  await recordBroadcastRecipients(supabaseAdmin(), accountId, amount);
}

/**
 * Run a guard in a route that has no surrounding try/catch. Resolves
 * to the 402 response when the guard refuses, null when it passes:
 *
 *   const blocked = await billingBlock(() => requireWritable(accountId))
 *   if (blocked) return blocked
 */
export async function billingBlock(
  check: () => Promise<unknown>,
): Promise<NextResponse | null> {
  try {
    await check();
    return null;
  } catch (err) {
    const response = billingErrorResponse(err);
    if (response) return response;
    throw err;
  }
}

/**
 * Map a `BillingError` to the dashboard's `{ error }` response shape,
 * or null for anything else so the caller's own handling continues:
 *
 *   } catch (err) {
 *     const billing = billingErrorResponse(err)
 *     if (billing) return billing
 *     …
 *   }
 */
export function billingErrorResponse(err: unknown): NextResponse | null {
  if (!(err instanceof BillingError)) return null;
  return NextResponse.json(
    { error: err.message, code: err.code, ...err.details },
    { status: err.status },
  );
}
