import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingError } from './entitlements';
import { PLANS } from './plans';

// ---------------------------------------------------------------------------
// The guards against a canned service-role client: one subscription row and a
// row count per table, each overridable per test.
// ---------------------------------------------------------------------------

type Result = { data?: unknown; count?: number | null; error: { message: string } | null };

const state = {
  subscription: null as Record<string, unknown> | null,
  subscriptionError: null as { message: string } | null,
  counts: {} as Record<string, number>,
  countError: null as { message: string } | null,
  usageCount: 0,
  rpc: vi.fn(async () => ({ error: null })),
};

function from(table: string) {
  const resolve = (): Result => {
    if (table === 'account_subscriptions') {
      return { data: state.subscription, error: state.subscriptionError };
    }
    if (table === 'billing_usage') {
      return { data: { count: state.usageCount }, error: null };
    }
    if (state.countError) return { count: null, error: state.countError };
    return { count: state.counts[table] ?? 0, error: null };
  };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'gt']) {
    builder[method] = () => builder;
  }
  builder.maybeSingle = async () => resolve();
  builder.then = (onFulfilled: (value: Result) => unknown) => onFulfilled(resolve());
  return builder;
}

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ from, rpc: state.rpc }),
}));

const {
  billingBlock,
  billingErrorResponse,
  getAccountAccess,
  isBillingEnforced,
  recordCampaignSends,
  requireFeature,
  requireWithinLimit,
  requireWritable,
} = await import('./guard');

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    account_id: 'acct-1',
    plan: 'trial',
    status: 'trialing',
    trial_ends_at: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    current_period_end: null,
    cancel_at_period_end: false,
    provider_customer_id: null,
    provider_subscription_id: null,
    ...overrides,
  };
}

async function expectBillingError(promise: Promise<unknown>, code: BillingError['code']) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BillingError);
  expect((err as BillingError).code).toBe(code);
  return err as BillingError;
}

beforeEach(() => {
  // Test-only placeholder — any non-empty value switches enforcement on.
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_placeholder');
  state.subscription = subscription();
  state.subscriptionError = null;
  state.counts = {};
  state.countError = null;
  state.usageCount = 0;
  state.rpc.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('isBillingEnforced', () => {
  it('is on only when a provider key is configured', () => {
    expect(isBillingEnforced()).toBe(true);
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect(isBillingEnforced()).toBe(false);
  });
});

describe('when billing is not configured', () => {
  beforeEach(() => vi.stubEnv('STRIPE_SECRET_KEY', ''));

  it('allows everything, even for an expired trial at its limits', async () => {
    state.subscription = subscription({
      trial_ends_at: '2020-01-01T00:00:00Z',
    });
    state.counts.contacts = 10_000_000;

    await expect(requireWritable('acct-1')).resolves.toMatchObject({
      enforced: false,
    });
    await expect(requireWithinLimit('acct-1', 'contacts', 500)).resolves.toBeTruthy();
    await expect(requireFeature('acct-1', 'apiAccess')).resolves.toBeTruthy();
  });

  it('does not record campaign usage', async () => {
    await recordCampaignSends('acct-1', 10);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe('requireWritable', () => {
  it('passes during the trial', async () => {
    await expect(requireWritable('acct-1')).resolves.toMatchObject({
      state: 'trialing',
      canWrite: true,
    });
  });

  it('refuses once the trial has ended', async () => {
    state.subscription = subscription({ trial_ends_at: '2020-01-01T00:00:00Z' });
    await expectBillingError(requireWritable('acct-1'), 'subscription_inactive');
  });

  it('refuses a canceled subscription', async () => {
    state.subscription = subscription({ plan: 'growth', status: 'canceled' });
    await expectBillingError(requireWritable('acct-1'), 'subscription_inactive');
  });

  it('still allows a past-due subscription', async () => {
    state.subscription = subscription({ plan: 'starter', status: 'past_due' });
    await expect(requireWritable('acct-1')).resolves.toMatchObject({
      state: 'past_due',
    });
  });

  it('fails open when the subscription cannot be read', async () => {
    state.subscription = null;
    state.subscriptionError = { message: 'relation does not exist' };
    await expect(requireWritable('acct-1')).resolves.toMatchObject({
      enforced: false,
      canWrite: true,
    });
  });
});

describe('requireWithinLimit', () => {
  const contactMax = PLANS.trial.limits.contacts as number;
  const seatMax = PLANS.trial.limits.seats as number;

  it('allows a create below the limit', async () => {
    state.counts.contacts = contactMax - 1;
    await expect(requireWithinLimit('acct-1', 'contacts')).resolves.toBeTruthy();
  });

  it('refuses a create at the limit', async () => {
    state.counts.contacts = contactMax;
    const err = await expectBillingError(
      requireWithinLimit('acct-1', 'contacts'),
      'limit_reached',
    );
    expect(err.details).toMatchObject({ limit: 'contacts', max: contactMax });
  });

  it('refuses an import batch that would cross the limit', async () => {
    state.counts.contacts = contactMax - 10;
    await expectBillingError(
      requireWithinLimit('acct-1', 'contacts', 50),
      'limit_reached',
    );
    await expect(requireWithinLimit('acct-1', 'contacts', 10)).resolves.toBeTruthy();
  });

  it('counts pending invitations as seats', async () => {
    // 2 members + 1 pending invite = all 3 trial seats taken.
    state.counts.profiles = seatMax - 1;
    state.counts.account_invitations = 1;
    await expectBillingError(requireWithinLimit('acct-1', 'seats'), 'limit_reached');

    state.counts.account_invitations = 0;
    await expect(requireWithinLimit('acct-1', 'seats')).resolves.toBeTruthy();
  });

  it("meters campaigns against this month's recorded sends", async () => {
    const max = PLANS.trial.limits.broadcastRecipientsPerMonth as number;
    state.usageCount = max - 100;
    await expect(
      requireWithinLimit('acct-1', 'broadcastRecipientsPerMonth', 100),
    ).resolves.toBeTruthy();
    await expectBillingError(
      requireWithinLimit('acct-1', 'broadcastRecipientsPerMonth', 101),
      'limit_reached',
    );
  });

  it('applies the higher limits of a paid plan', async () => {
    state.subscription = subscription({ plan: 'starter', status: 'active' });
    state.counts.contacts = contactMax;
    await expect(requireWithinLimit('acct-1', 'contacts')).resolves.toBeTruthy();
  });

  it('skips counting for an unlimited limit', async () => {
    state.subscription = subscription({ plan: 'growth', status: 'active' });
    state.countError = { message: 'should not be queried' };
    await expect(requireWithinLimit('acct-1', 'automations')).resolves.toBeTruthy();
  });

  it('refuses a read-only workspace regardless of usage', async () => {
    state.subscription = subscription({ trial_ends_at: '2020-01-01T00:00:00Z' });
    await expectBillingError(
      requireWithinLimit('acct-1', 'contacts'),
      'subscription_inactive',
    );
  });

  it('fails open when usage cannot be counted', async () => {
    state.countError = { message: 'timeout' };
    await expect(requireWithinLimit('acct-1', 'contacts')).resolves.toBeTruthy();
  });
});

describe('requireFeature', () => {
  it('allows the API on the trial and on Growth', async () => {
    await expect(requireFeature('acct-1', 'apiAccess')).resolves.toBeTruthy();
    state.subscription = subscription({ plan: 'growth', status: 'active' });
    await expect(requireFeature('acct-1', 'apiAccess')).resolves.toBeTruthy();
  });

  it('refuses the API on Starter', async () => {
    state.subscription = subscription({ plan: 'starter', status: 'active' });
    await expectBillingError(
      requireFeature('acct-1', 'apiAccess'),
      'feature_unavailable',
    );
  });
});

describe('getAccountAccess', () => {
  it('treats an account with no row as an open trial', async () => {
    state.subscription = null;
    await expect(getAccountAccess('acct-1')).resolves.toMatchObject({
      enforced: true,
      state: 'trialing',
      canWrite: true,
    });
  });
});

describe('recordCampaignSends', () => {
  it('adds sends to the current month', async () => {
    await recordCampaignSends('acct-1', 42);
    expect(state.rpc).toHaveBeenCalledWith(
      'increment_billing_usage',
      expect.objectContaining({
        p_account_id: 'acct-1',
        p_metric: 'broadcast_recipients',
        p_amount: 42,
        p_period_start: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      }),
    );
  });

  it('records nothing when nothing was sent', async () => {
    await recordCampaignSends('acct-1', 0);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});

describe('response mapping', () => {
  it('maps a refusal to a 402 with the billing code', async () => {
    state.counts.contacts = PLANS.trial.limits.contacts as number;
    const response = await billingBlock(() => requireWithinLimit('acct-1', 'contacts'));

    expect(response?.status).toBe(402);
    const body = await response!.json();
    expect(body).toMatchObject({ code: 'limit_reached', limit: 'contacts', plan: 'trial' });
    expect(body.error).toContain('Settings → Billing');
  });

  it('resolves to null when the guard passes', async () => {
    expect(await billingBlock(() => requireWritable('acct-1'))).toBeNull();
  });

  it('rethrows anything that is not a billing refusal', async () => {
    await expect(
      billingBlock(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(billingErrorResponse(new Error('boom'))).toBeNull();
  });
});
