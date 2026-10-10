// ============================================================
// Apply a verified provider webhook to `account_subscriptions`.
//
// Provider-agnostic: takes the normalised `BillingEvent` from
// `BillingProvider.parseWebhook` and a Supabase client (service role).
//
// Safe against the two things webhooks do in practice:
//   - Redelivery  — every event id is claimed in `billing_events`
//                   first; a second delivery finds the claim and stops.
//                   If applying fails the claim is released so the
//                   provider's retry can succeed.
//   - Reordering  — the row remembers the newest event applied
//                   (`provider_event_at`); an older one is skipped.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SubscriptionRow } from './entitlements';
import { planForPriceId } from './plans';
import type { BillingEvent, SubscriptionUpdate } from './provider';
import { SUBSCRIPTION_COLUMNS } from './store';

export type WebhookOutcome =
  /** The subscription row was written. */
  | 'applied'
  /** Already processed this event id. */
  | 'duplicate'
  /** Nothing to do: unhandled type, unknown account, or not our subscription. */
  | 'ignored'
  /** An older event than one already applied. */
  | 'stale';

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

async function findRow(
  db: SupabaseClient,
  column: 'account_id' | 'provider_subscription_id' | 'provider_customer_id',
  value: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await db
    .from('account_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq(column, value)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`account_subscriptions lookup failed: ${error.message}`);
  return (data as unknown as SubscriptionRow | null) ?? null;
}

/** Find the row an update is about: by subscription, then by customer. */
async function findRowByProviderIds(
  db: SupabaseClient,
  update: SubscriptionUpdate,
): Promise<SubscriptionRow | null> {
  if (update.subscriptionId) {
    const row = await findRow(db, 'provider_subscription_id', update.subscriptionId);
    if (row) return row;
  }
  if (update.customerId) {
    return findRow(db, 'provider_customer_id', update.customerId);
  }
  return null;
}

async function applyUpdate(
  db: SupabaseClient,
  event: BillingEvent,
  update: SubscriptionUpdate,
): Promise<WebhookOutcome> {
  const existing =
    update.kind === 'subscription' && update.accountId
      ? await findRow(db, 'account_id', update.accountId)
      : await findRowByProviderIds(db, update);

  const accountId =
    existing?.account_id ??
    (update.kind === 'subscription' ? update.accountId : null);
  if (!accountId) {
    console.warn(`[billing] ${event.type} ${event.id}: no matching account, ignoring`);
    return 'ignored';
  }

  if (
    existing?.provider_event_at &&
    event.createdAt.getTime() < Date.parse(existing.provider_event_at)
  ) {
    return 'stale';
  }

  const eventAt = event.createdAt.toISOString();

  if (update.kind === 'payment_failed') {
    // Only meaningful for the subscription we're tracking, and only
    // while it's active — never resurrect a canceled row to past_due.
    if (
      !existing ||
      existing.status !== 'active' ||
      (update.subscriptionId &&
        existing.provider_subscription_id &&
        update.subscriptionId !== existing.provider_subscription_id)
    ) {
      return 'ignored';
    }
    const { error } = await db
      .from('account_subscriptions')
      .update({ status: 'past_due', provider_event_at: eventAt })
      .eq('account_id', accountId);
    if (error) throw new Error(`account_subscriptions update failed: ${error.message}`);
    return 'applied';
  }

  // A first payment that hasn't gone through yet — not a state change.
  if (!update.status) return 'ignored';

  // After a customer re-subscribes, the old subscription's late
  // "canceled" must not take down the new one.
  const tracksAnother =
    !!existing?.provider_subscription_id &&
    existing.provider_subscription_id !== update.subscriptionId;
  if (tracksAnother && update.status === 'canceled') return 'ignored';

  const plan = planForPriceId(update.priceId);
  if (!plan) {
    // The price isn't one of ours (env var missing or a price created
    // by hand in the provider dashboard). Keep whatever paid plan the
    // row had rather than silently granting or revoking limits.
    console.error(
      `[billing] ${event.type} ${event.id}: price '${update.priceId}' matches no configured plan`,
    );
    if (!existing || existing.plan === 'trial') return 'ignored';
  }

  const row = {
    account_id: accountId,
    plan: plan ?? existing!.plan,
    status: update.status,
    provider: event.provider,
    provider_customer_id: update.customerId ?? existing?.provider_customer_id ?? null,
    provider_subscription_id: update.subscriptionId,
    provider_price_id: update.priceId,
    current_period_end: update.currentPeriodEnd?.toISOString() ?? null,
    cancel_at_period_end: update.cancelAtPeriodEnd,
    provider_event_at: eventAt,
  };

  const { error } = await db
    .from('account_subscriptions')
    .upsert(row, { onConflict: 'account_id' });
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      // The account was deleted. Retrying can never succeed.
      console.warn(`[billing] ${event.type} ${event.id}: account ${accountId} no longer exists`);
      return 'ignored';
    }
    throw new Error(`account_subscriptions upsert failed: ${error.message}`);
  }
  return 'applied';
}

/**
 * Process one verified webhook event. Throws only when the event
 * should be retried by the provider (a database failure).
 */
export async function handleBillingEvent(
  db: SupabaseClient,
  event: BillingEvent,
): Promise<WebhookOutcome> {
  const { error: claimErr } = await db.from('billing_events').insert({
    provider: event.provider,
    event_id: event.id,
    event_type: event.type,
  });
  if (claimErr) {
    if (claimErr.code === UNIQUE_VIOLATION) return 'duplicate';
    throw new Error(`billing_events insert failed: ${claimErr.message}`);
  }

  if (!event.update) return 'ignored';

  try {
    return await applyUpdate(db, event, event.update);
  } catch (err) {
    // Release the claim so the provider's retry isn't treated as a
    // duplicate of an event that was never actually applied.
    await db
      .from('billing_events')
      .delete()
      .eq('provider', event.provider)
      .eq('event_id', event.id);
    throw err;
  }
}
