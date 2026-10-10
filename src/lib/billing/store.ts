// ============================================================
// Billing data access — subscription row + usage counts.
//
// Every function takes the Supabase client explicitly. Callers pass
// the service-role client: usage must be counted across the whole
// account regardless of the caller's role (an agent can't see pending
// invitations under RLS, but they still occupy seats).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { SubscriptionRow } from './entitlements';
import type { LimitKey } from './plans';

export const SUBSCRIPTION_COLUMNS =
  'account_id, plan, status, provider, provider_customer_id, provider_subscription_id, provider_price_id, trial_ends_at, current_period_end, cancel_at_period_end, provider_event_at';

/** Metric name in `billing_usage` for campaign messages sent. */
export const BROADCAST_RECIPIENTS_METRIC = 'broadcast_recipients';

/** First day (UTC) of the month containing `now`, as `YYYY-MM-DD`. */
export function monthPeriodStart(now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}

/**
 * Load an account's subscription row. Returns null when there is none;
 * throws on a query error so the caller can decide how to degrade.
 */
export async function loadSubscription(
  db: SupabaseClient,
  accountId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await db
    .from('account_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw new Error(`account_subscriptions lookup failed: ${error.message}`);
  // The demo-mode mock client answers every single-row read with a
  // placeholder object; only a row that names its account is real.
  const row = data as unknown as SubscriptionRow | null;
  return row && row.account_id === accountId ? row : null;
}

async function countRows(
  db: SupabaseClient,
  table: string,
  column: string,
  accountId: string,
): Promise<number> {
  const { count, error } = await db
    .from(table)
    .select(column, { count: 'exact', head: true })
    .eq('account_id', accountId);
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

/** Current usage of one limit. Throws on a query error. */
export async function countUsage(
  db: SupabaseClient,
  accountId: string,
  key: LimitKey,
  now = new Date(),
): Promise<number> {
  switch (key) {
    case 'seats': {
      // A pending invitation holds a seat: otherwise an admin could
      // mint unlimited links and exceed the plan as they're redeemed.
      const [members, pending] = await Promise.all([
        countRows(db, 'profiles', 'user_id', accountId),
        (async () => {
          const { count, error } = await db
            .from('account_invitations')
            .select('id', { count: 'exact', head: true })
            .eq('account_id', accountId)
            .is('accepted_at', null)
            .gt('expires_at', now.toISOString());
          if (error) throw new Error(`account_invitations count failed: ${error.message}`);
          return count ?? 0;
        })(),
      ]);
      return members + pending;
    }
    case 'contacts':
      return countRows(db, 'contacts', 'id', accountId);
    case 'automations':
      return countRows(db, 'automations', 'id', accountId);
    case 'flows':
      return countRows(db, 'flows', 'id', accountId);
    case 'broadcastRecipientsPerMonth': {
      const { data, error } = await db
        .from('billing_usage')
        .select('count')
        .eq('account_id', accountId)
        .eq('metric', BROADCAST_RECIPIENTS_METRIC)
        .eq('period_start', monthPeriodStart(now))
        .maybeSingle();
      if (error) throw new Error(`billing_usage lookup failed: ${error.message}`);
      const value = Number((data as { count?: unknown } | null)?.count ?? 0);
      return Number.isFinite(value) ? value : 0;
    }
  }
}

export type UsageSnapshot = Record<LimitKey, number>;

/** Usage of every limit at once, for the Billing tab. */
export async function loadUsage(
  db: SupabaseClient,
  accountId: string,
  now = new Date(),
): Promise<UsageSnapshot> {
  const keys: LimitKey[] = [
    'seats',
    'contacts',
    'broadcastRecipientsPerMonth',
    'automations',
    'flows',
  ];
  const values = await Promise.all(
    keys.map((key) =>
      // One failing count shouldn't blank the whole panel.
      countUsage(db, accountId, key, now).catch((err) => {
        console.error(`[billing] usage count for '${key}' failed:`, err);
        return 0;
      }),
    ),
  );
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as UsageSnapshot;
}

/**
 * Add `amount` campaign messages to this month's counter. Best-effort:
 * the messages are already sent, so a failure here is logged, never
 * thrown.
 */
export async function recordBroadcastRecipients(
  db: SupabaseClient,
  accountId: string,
  amount: number,
  now = new Date(),
): Promise<void> {
  if (amount <= 0) return;
  const { error } = await db.rpc('increment_billing_usage', {
    p_account_id: accountId,
    p_metric: BROADCAST_RECIPIENTS_METRIC,
    p_period_start: monthPeriodStart(now),
    p_amount: amount,
  });
  if (error) {
    console.error('[billing] failed to record campaign usage:', error.message);
  }
}
