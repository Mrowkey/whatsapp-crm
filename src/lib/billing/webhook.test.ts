import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BillingEvent, SubscriptionUpdate } from './provider';
import { handleBillingEvent } from './webhook';

// ---------------------------------------------------------------------------
// A tiny in-memory stand-in for the two tables the handler touches. It
// models just enough PostgREST behaviour to exercise the real handler:
// primary-key conflicts on insert, eq-filtered reads/updates/deletes, and
// upsert-by-account.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function makeDb() {
  const tables: Record<string, Row[]> = {
    account_subscriptions: [],
    billing_events: [],
  };
  /** Set to make the next write to `account_subscriptions` fail. */
  const failNext: { error: { code?: string; message: string } | null } = {
    error: null,
  };

  function from(table: string) {
    const rows = tables[table];
    const filters: [string, unknown][] = [];
    let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let payload: Row = {};

    const matches = (row: Row) => filters.every(([k, v]) => row[k] === v);

    const run = () => {
      if (table === 'account_subscriptions' && op !== 'select' && failNext.error) {
        const error = failNext.error;
        failNext.error = null;
        return { data: null, error };
      }
      switch (op) {
        case 'insert': {
          if (
            table === 'billing_events' &&
            rows.some(
              (r) => r.provider === payload.provider && r.event_id === payload.event_id,
            )
          ) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          rows.push({ ...payload });
          return { data: null, error: null };
        }
        case 'upsert': {
          const existing = rows.find((r) => r.account_id === payload.account_id);
          if (existing) Object.assign(existing, payload);
          else rows.push({ ...payload });
          return { data: null, error: null };
        }
        case 'update':
          rows.filter(matches).forEach((r) => Object.assign(r, payload));
          return { data: null, error: null };
        case 'delete':
          tables[table] = rows.filter((r) => !matches(r));
          return { data: null, error: null };
        case 'select':
          return { data: rows.find(matches) ?? null, error: null };
      }
    };

    const builder = {
      select: () => builder,
      insert: (row: Row) => ((op = 'insert'), (payload = row), builder),
      update: (row: Row) => ((op = 'update'), (payload = row), builder),
      upsert: (row: Row) => ((op = 'upsert'), (payload = row), builder),
      delete: () => ((op = 'delete'), builder),
      eq: (column: string, value: unknown) => (filters.push([column, value]), builder),
      limit: () => builder,
      maybeSingle: async () => run(),
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };
    return builder;
  }

  return {
    db: { from } as unknown as SupabaseClient,
    tables,
    failNext,
    sub: () => tables.account_subscriptions[0],
  };
}

const T0 = new Date('2026-10-10T10:00:00Z');
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

function subEvent(
  id: string,
  overrides: Partial<Extract<SubscriptionUpdate, { kind: 'subscription' }>> = {},
  createdAt = T0,
  type = 'customer.subscription.updated',
): BillingEvent {
  return {
    provider: 'stripe',
    id,
    type,
    createdAt,
    update: {
      kind: 'subscription',
      accountId: 'acct-1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      priceId: 'price_starter',
      status: 'active',
      currentPeriodEnd: new Date('2026-11-10T10:00:00Z'),
      cancelAtPeriodEnd: false,
      ...overrides,
    },
  };
}

function trialRow(): Row {
  return {
    account_id: 'acct-1',
    plan: 'trial',
    status: 'trialing',
    provider: null,
    provider_customer_id: null,
    provider_subscription_id: null,
    provider_price_id: null,
    trial_ends_at: '2026-10-20T00:00:00Z',
    current_period_end: null,
    cancel_at_period_end: false,
    provider_event_at: null,
  };
}

beforeEach(() => {
  vi.stubEnv('STRIPE_PRICE_STARTER', 'price_starter');
  vi.stubEnv('STRIPE_PRICE_GROWTH', 'price_growth');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('handleBillingEvent', () => {
  it('upgrades a trial account when its subscription becomes active', async () => {
    const { db, tables, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());

    const outcome = await handleBillingEvent(db, subEvent('evt_1'));

    expect(outcome).toBe('applied');
    expect(sub()).toMatchObject({
      plan: 'starter',
      status: 'active',
      provider: 'stripe',
      provider_customer_id: 'cus_1',
      provider_subscription_id: 'sub_1',
      provider_price_id: 'price_starter',
      current_period_end: '2026-11-10T10:00:00.000Z',
      cancel_at_period_end: false,
      provider_event_at: T0.toISOString(),
      // The trial end date is history, not overwritten.
      trial_ends_at: '2026-10-20T00:00:00Z',
    });
  });

  it('creates the row when the account has none yet', async () => {
    const { db, sub } = makeDb();
    expect(await handleBillingEvent(db, subEvent('evt_1'))).toBe('applied');
    expect(sub()).toMatchObject({ account_id: 'acct-1', plan: 'starter' });
  });

  it('is idempotent: a redelivered event changes nothing', async () => {
    const { db, tables, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());

    await handleBillingEvent(db, subEvent('evt_1'));
    // Simulate drift a replay must not undo.
    sub().plan = 'growth';

    expect(await handleBillingEvent(db, subEvent('evt_1'))).toBe('duplicate');
    expect(sub().plan).toBe('growth');
    expect(tables.billing_events).toHaveLength(1);
  });

  it('skips an event older than the one already applied', async () => {
    const { db, tables, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());

    await handleBillingEvent(
      db,
      subEvent('evt_new', { priceId: 'price_growth' }, later(5)),
    );
    const outcome = await handleBillingEvent(
      db,
      subEvent('evt_old', { priceId: 'price_starter' }, T0),
    );

    expect(outcome).toBe('stale');
    expect(sub().plan).toBe('growth');
  });

  it('moves between paid plans on a plan change', async () => {
    const { db, tables, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());

    await handleBillingEvent(db, subEvent('evt_1'));
    await handleBillingEvent(
      db,
      subEvent('evt_2', { priceId: 'price_growth' }, later(1)),
    );

    expect(sub()).toMatchObject({ plan: 'growth', status: 'active' });
  });

  it('records a scheduled cancellation without ending access', async () => {
    const { db, tables, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());

    await handleBillingEvent(db, subEvent('evt_1'));
    await handleBillingEvent(
      db,
      subEvent('evt_2', { cancelAtPeriodEnd: true }, later(1)),
    );

    expect(sub()).toMatchObject({ status: 'active', cancel_at_period_end: true });
  });

  it('marks the account canceled when the subscription is deleted', async () => {
    const { db, tables, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());

    await handleBillingEvent(db, subEvent('evt_1'));
    await handleBillingEvent(
      db,
      subEvent(
        'evt_2',
        { status: 'canceled', accountId: null },
        later(1),
        'customer.subscription.deleted',
      ),
    );

    // Found by subscription id even though the event had no account id.
    expect(sub()).toMatchObject({ status: 'canceled', plan: 'starter' });
  });

  it("ignores an old subscription's cancel after the customer re-subscribed", async () => {
    const { db, tables, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());

    await handleBillingEvent(db, subEvent('evt_1', { subscriptionId: 'sub_new' }));
    const outcome = await handleBillingEvent(
      db,
      subEvent(
        'evt_2',
        { subscriptionId: 'sub_old', status: 'canceled' },
        later(1),
        'customer.subscription.deleted',
      ),
    );

    expect(outcome).toBe('ignored');
    expect(sub()).toMatchObject({
      status: 'active',
      provider_subscription_id: 'sub_new',
    });
  });

  it('ignores a first payment that has not completed', async () => {
    const { db, tables, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());

    const outcome = await handleBillingEvent(
      db,
      subEvent('evt_1', { status: null }),
    );

    expect(outcome).toBe('ignored');
    expect(sub()).toMatchObject({ plan: 'trial', status: 'trialing' });
  });

  it('does not grant a plan for a price it does not recognise', async () => {
    const { db, tables, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());

    const outcome = await handleBillingEvent(
      db,
      subEvent('evt_1', { priceId: 'price_unknown' }),
    );

    expect(outcome).toBe('ignored');
    expect(sub().plan).toBe('trial');
  });

  it('keeps the paid plan when a later event carries an unknown price', async () => {
    const { db, tables, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());

    await handleBillingEvent(db, subEvent('evt_1'));
    await handleBillingEvent(
      db,
      subEvent('evt_2', { priceId: 'price_unknown', status: 'past_due' }, later(1)),
    );

    expect(sub()).toMatchObject({ plan: 'starter', status: 'past_due' });
  });

  describe('invoice.payment_failed', () => {
    const failed = (id: string, subscriptionId: string | null, at: Date): BillingEvent => ({
      provider: 'stripe',
      id,
      type: 'invoice.payment_failed',
      createdAt: at,
      update: { kind: 'payment_failed', customerId: 'cus_1', subscriptionId },
    });

    it('marks an active subscription past due', async () => {
      const { db, tables, sub } = makeDb();
      tables.account_subscriptions.push(trialRow());
      await handleBillingEvent(db, subEvent('evt_1'));

      const outcome = await handleBillingEvent(db, failed('evt_2', 'sub_1', later(1)));

      expect(outcome).toBe('applied');
      expect(sub()).toMatchObject({ status: 'past_due', plan: 'starter' });
    });

    it('finds the account by customer when the invoice has no subscription', async () => {
      const { db, tables, sub } = makeDb();
      tables.account_subscriptions.push(trialRow());
      await handleBillingEvent(db, subEvent('evt_1'));

      await handleBillingEvent(db, failed('evt_2', null, later(1)));

      expect(sub().status).toBe('past_due');
    });

    it('never revives a canceled subscription', async () => {
      const { db, tables, sub } = makeDb();
      tables.account_subscriptions.push(trialRow());
      await handleBillingEvent(db, subEvent('evt_1', { status: 'canceled' }));

      const outcome = await handleBillingEvent(db, failed('evt_2', 'sub_1', later(1)));

      expect(outcome).toBe('ignored');
      expect(sub().status).toBe('canceled');
    });

    it('ignores a failure for an account it cannot identify', async () => {
      const { db } = makeDb();
      expect(await handleBillingEvent(db, failed('evt_1', 'sub_x', T0))).toBe('ignored');
    });
  });

  describe('invoice paid', () => {
    const paid = (id: string, subscriptionId: string | null, at: Date): BillingEvent => ({
      provider: 'stripe',
      id,
      type: 'invoice.paid',
      createdAt: at,
      update: { kind: 'payment_succeeded', customerId: 'cus_1', subscriptionId },
    });

    it('lifts a past-due subscription back to active', async () => {
      const { db, tables, sub } = makeDb();
      tables.account_subscriptions.push(trialRow());
      await handleBillingEvent(db, subEvent('evt_1', { status: 'past_due' }));

      const outcome = await handleBillingEvent(db, paid('evt_2', 'sub_1', later(1)));

      expect(outcome).toBe('applied');
      expect(sub()).toMatchObject({ status: 'active', plan: 'starter' });
    });

    it('does not reactivate a canceled subscription', async () => {
      const { db, tables, sub } = makeDb();
      tables.account_subscriptions.push(trialRow());
      await handleBillingEvent(db, subEvent('evt_1', { status: 'canceled' }));

      expect(await handleBillingEvent(db, paid('evt_2', 'sub_1', later(1)))).toBe('ignored');
      expect(sub().status).toBe('canceled');
    });

    it('does not turn a trial into a paid plan', async () => {
      const { db, tables, sub } = makeDb();
      tables.account_subscriptions.push(trialRow());

      expect(await handleBillingEvent(db, paid('evt_1', null, T0))).toBe('ignored');
      expect(sub()).toMatchObject({ plan: 'trial', status: 'trialing' });
    });

    it("ignores a payment for a subscription the account isn't tracking", async () => {
      const { db, tables, sub } = makeDb();
      tables.account_subscriptions.push(trialRow());
      await handleBillingEvent(db, subEvent('evt_1', { status: 'past_due' }));

      // Found by customer id, but it's a different subscription's invoice.
      expect(await handleBillingEvent(db, paid('evt_2', 'sub_other', later(1)))).toBe(
        'ignored',
      );
      expect(sub().status).toBe('past_due');
    });
  });

  it('ignores event types that carry no update, but still records them', async () => {
    const { db, tables } = makeDb();
    const outcome = await handleBillingEvent(db, {
      provider: 'stripe',
      id: 'evt_1',
      type: 'customer.created',
      createdAt: T0,
      update: null,
    });
    expect(outcome).toBe('ignored');
    expect(tables.billing_events).toHaveLength(1);
  });

  it('releases its claim when applying fails, so the retry is processed', async () => {
    const { db, tables, failNext, sub } = makeDb();
    tables.account_subscriptions.push(trialRow());
    failNext.error = { message: 'connection reset' };

    await expect(handleBillingEvent(db, subEvent('evt_1'))).rejects.toThrow(
      /upsert failed/,
    );
    expect(tables.billing_events).toHaveLength(0);
    expect(sub().plan).toBe('trial');

    // The provider retries the same event id — now it lands.
    expect(await handleBillingEvent(db, subEvent('evt_1'))).toBe('applied');
    expect(sub().plan).toBe('starter');
  });

  it('gives up quietly when the account no longer exists', async () => {
    const { db, tables, failNext } = makeDb();
    failNext.error = { code: '23503', message: 'foreign key violation' };

    expect(await handleBillingEvent(db, subEvent('evt_1'))).toBe('ignored');
    // Claim kept: retrying could never succeed.
    expect(tables.billing_events).toHaveLength(1);
  });
});
