import { afterEach, describe, expect, it, vi } from 'vitest';

import { PLANS, UNLIMITED } from './plans';
import { assertCampaignAllowed, campaignBlockReason } from './preflight';
import type { BillingSummary } from './summary';

function summary(overrides: Partial<BillingSummary> = {}): BillingSummary {
  return {
    configured: true,
    enforced: true,
    canManage: true,
    plan: 'trial',
    state: 'trialing',
    canWrite: true,
    limits: PLANS.trial.limits,
    usage: {
      seats: 1,
      contacts: 10,
      broadcastRecipientsPerMonth: 0,
      automations: 0,
      flows: 0,
    },
    trialEndsAt: null,
    trialDaysLeft: 5,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    hasPaidSubscription: false,
    hasCustomer: false,
    purchasablePlans: ['starter', 'growth'],
    ...overrides,
  };
}

const withUsed = (used: number) =>
  summary({
    usage: { ...summary().usage, broadcastRecipientsPerMonth: used },
  });

describe('campaignBlockReason', () => {
  it('allows a campaign that fits the remaining allowance exactly', () => {
    expect(campaignBlockReason(withUsed(600), 400)).toBeNull();
  });

  it('blocks a campaign larger than what is left, saying how many are left', () => {
    const reason = campaignBlockReason(withUsed(600), 401);
    expect(reason).toContain('401 recipients');
    expect(reason).toContain('only 400 of your 1,000');
    expect(reason).toContain('Free trial');
  });

  it('reports zero left rather than a negative number when over the limit', () => {
    expect(campaignBlockReason(withUsed(1500), 10)).toContain('only 0 of your 1,000');
  });

  it('blocks any campaign once the trial has ended', () => {
    const reason = campaignBlockReason(
      summary({ canWrite: false, state: 'trial_expired' }),
      1,
    );
    expect(reason).toContain('free trial has ended');
  });

  it('blocks any campaign for a canceled subscription', () => {
    const reason = campaignBlockReason(
      summary({ canWrite: false, state: 'canceled', plan: 'starter' }),
      1,
    );
    expect(reason).toContain('no longer active');
  });

  it('never blocks when billing is not enforced', () => {
    expect(
      campaignBlockReason(
        summary({ enforced: false, state: 'unenforced', limits: UNLIMITED }),
        1_000_000,
      ),
    ).toBeNull();
  });
});

describe('assertCampaignAllowed', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('throws the reason when the plan would refuse the send', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(withUsed(990)))),
    );
    await expect(assertCampaignAllowed(50)).rejects.toThrow(/only 10 of your 1,000/);
  });

  it('passes when the campaign fits', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(withUsed(0)))),
    );
    await expect(assertCampaignAllowed(50)).resolves.toBeUndefined();
  });

  it('stays out of the way when the plan cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(assertCampaignAllowed(50)).resolves.toBeUndefined();

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await expect(assertCampaignAllowed(50)).resolves.toBeUndefined();
  });
});
