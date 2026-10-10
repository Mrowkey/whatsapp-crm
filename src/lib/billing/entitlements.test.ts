import { describe, expect, it } from 'vitest';

import {
  BillingError,
  assertFeature,
  assertLimit,
  assertWritable,
  remaining,
  resolveAccess,
  type SubscriptionRow,
} from './entitlements';
import { PLANS, UNLIMITED } from './plans';

const NOW = new Date('2026-10-10T00:00:00Z');

function sub(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
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
    ...overrides,
  };
}

const enforced = { enforced: true, now: NOW };

function expectBillingError(fn: () => void, code: BillingError['code']) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BillingError);
    expect((err as BillingError).code).toBe(code);
    expect((err as BillingError).status).toBe(402);
    return err as BillingError;
  }
  throw new Error('expected a BillingError');
}

describe('resolveAccess', () => {
  it('lifts every limit when billing is not enforced', () => {
    const access = resolveAccess(sub({ status: 'canceled' }), {
      enforced: false,
      now: NOW,
    });
    expect(access.state).toBe('unenforced');
    expect(access.canWrite).toBe(true);
    expect(access.limits).toEqual(UNLIMITED);
  });

  it('treats a running trial as writable with trial limits', () => {
    const access = resolveAccess(sub(), enforced);
    expect(access.state).toBe('trialing');
    expect(access.canWrite).toBe(true);
    expect(access.limits).toEqual(PLANS.trial.limits);
    expect(access.trialDaysLeft).toBe(10);
  });

  it('rounds a partial final day of trial up to 1', () => {
    const access = resolveAccess(
      sub({ trial_ends_at: '2026-10-10T06:00:00Z' }),
      enforced,
    );
    expect(access.trialDaysLeft).toBe(1);
    expect(access.canWrite).toBe(true);
  });

  it('makes the workspace read-only once the trial has ended', () => {
    const access = resolveAccess(
      sub({ trial_ends_at: '2026-10-09T23:59:59Z' }),
      enforced,
    );
    expect(access.state).toBe('trial_expired');
    expect(access.canWrite).toBe(false);
    expect(access.trialDaysLeft).toBe(0);
  });

  it('expires the trial exactly at its end instant', () => {
    const access = resolveAccess(
      sub({ trial_ends_at: NOW.toISOString() }),
      enforced,
    );
    expect(access.canWrite).toBe(false);
  });

  it('applies the paid plan limits when active', () => {
    const access = resolveAccess(
      sub({ plan: 'growth', status: 'active', trial_ends_at: null }),
      enforced,
    );
    expect(access.state).toBe('active');
    expect(access.plan).toBe('growth');
    expect(access.limits).toEqual(PLANS.growth.limits);
  });

  it('ignores a lapsed trial date once the account is on a paid plan', () => {
    const access = resolveAccess(
      sub({
        plan: 'starter',
        status: 'active',
        trial_ends_at: '2026-01-01T00:00:00Z',
      }),
      enforced,
    );
    expect(access.canWrite).toBe(true);
  });

  it('keeps a past-due account writable (the provider is retrying)', () => {
    const access = resolveAccess(
      sub({ plan: 'starter', status: 'past_due' }),
      enforced,
    );
    expect(access.state).toBe('past_due');
    expect(access.canWrite).toBe(true);
  });

  it.each(['canceled', 'unpaid', 'paused'] as const)(
    'makes a %s subscription read-only',
    (status) => {
      const access = resolveAccess(sub({ plan: 'growth', status }), enforced);
      expect(access.state).toBe('canceled');
      expect(access.canWrite).toBe(false);
    },
  );

  it('treats a missing row as an open trial rather than locking out', () => {
    const access = resolveAccess(null, enforced);
    expect(access.state).toBe('trialing');
    expect(access.canWrite).toBe(true);
    expect(access.limits).toEqual(PLANS.trial.limits);
  });

  it('falls back to trial limits for an unknown plan id', () => {
    const access = resolveAccess(
      sub({ plan: 'enterprise-legacy', status: 'active' }),
      enforced,
    );
    expect(access.plan).toBe('trial');
    expect(access.limits).toEqual(PLANS.trial.limits);
  });
});

describe('assertWritable', () => {
  it('passes for a writable workspace', () => {
    expect(() => assertWritable(resolveAccess(sub(), enforced))).not.toThrow();
  });

  it('throws subscription_inactive naming the ended trial', () => {
    const err = expectBillingError(
      () =>
        assertWritable(
          resolveAccess(sub({ trial_ends_at: '2026-10-01T00:00:00Z' }), enforced),
        ),
      'subscription_inactive',
    );
    expect(err.message).toContain('free trial has ended');
    expect(err.message).toContain('Settings → Billing');
  });

  it('throws subscription_inactive for a canceled subscription', () => {
    const err = expectBillingError(
      () =>
        assertWritable(
          resolveAccess(sub({ plan: 'starter', status: 'canceled' }), enforced),
        ),
      'subscription_inactive',
    );
    expect(err.message).toContain('no longer active');
  });
});

describe('assertLimit', () => {
  const trial = resolveAccess(sub(), enforced);
  const max = PLANS.trial.limits.contacts as number;

  it('allows usage up to and including the limit', () => {
    expect(() => assertLimit(trial, 'contacts', max - 1)).not.toThrow();
    expect(() => assertLimit(trial, 'contacts', max - 50, 50)).not.toThrow();
  });

  it('refuses the item that would exceed the limit', () => {
    const err = expectBillingError(
      () => assertLimit(trial, 'contacts', max),
      'limit_reached',
    );
    expect(err.details).toMatchObject({
      plan: 'trial',
      limit: 'contacts',
      max,
      used: max,
    });
    expect(err.message).toContain('1,000 contacts');
  });

  it('refuses a batch that would cross the limit, even from below it', () => {
    const err = expectBillingError(
      () => assertLimit(trial, 'broadcastRecipientsPerMonth', 900, 200),
      'limit_reached',
    );
    expect(err.message).toContain('900 used');
    expect(err.message).toContain('200 more requested');
  });

  it('never refuses an unlimited limit', () => {
    const growth = resolveAccess(
      sub({ plan: 'growth', status: 'active' }),
      enforced,
    );
    expect(() => assertLimit(growth, 'automations', 1_000_000)).not.toThrow();
  });

  it('refuses a read-only workspace before looking at usage', () => {
    const expired = resolveAccess(
      sub({ trial_ends_at: '2026-10-01T00:00:00Z' }),
      enforced,
    );
    expectBillingError(
      () => assertLimit(expired, 'contacts', 0),
      'subscription_inactive',
    );
  });

  it('is a no-op when billing is not enforced', () => {
    const open = resolveAccess(sub(), { enforced: false, now: NOW });
    expect(() => assertLimit(open, 'contacts', 10_000_000)).not.toThrow();
  });
});

describe('assertFeature', () => {
  it('allows the API on plans that include it', () => {
    expect(() =>
      assertFeature(resolveAccess(sub(), enforced), 'apiAccess'),
    ).not.toThrow();
  });

  it('refuses the API on Starter', () => {
    const err = expectBillingError(
      () =>
        assertFeature(
          resolveAccess(sub({ plan: 'starter', status: 'active' }), enforced),
          'apiAccess',
        ),
      'feature_unavailable',
    );
    expect(err.message).toContain('Starter');
  });
});

describe('remaining', () => {
  const trial = resolveAccess(sub(), enforced);

  it('returns what is left, never negative', () => {
    expect(remaining(trial, 'seats', 1)).toBe(2);
    expect(remaining(trial, 'seats', 99)).toBe(0);
  });

  it('returns null for an unlimited limit', () => {
    const growth = resolveAccess(
      sub({ plan: 'growth', status: 'active' }),
      enforced,
    );
    expect(remaining(growth, 'flows', 5)).toBeNull();
  });
});
