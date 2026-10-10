// ============================================================
// Billing plans — THE file to edit when prices or limits change.
//
// Pure data + pure helpers, safe to import from client and server.
// No secrets live here: the provider price ids come from the env vars
// named in `priceEnv` (see .env.local.example) and are only read on
// the server.
//
// The prices below are PLACEHOLDERS for display. What a customer is
// actually charged is whatever the provider price behind `priceEnv`
// says — keep the two in sync when you set real prices.
//
// What each limit meters
//   seats                       — team members + pending invitations
//   contacts                    — rows in `contacts`
//   broadcastRecipientsPerMonth — campaign messages sent in the
//                                 current calendar month (UTC), from
//                                 the dashboard and POST /api/v1/broadcasts
//   automations                 — rows in `automations`
//   flows                       — rows in `flows`
//   apiAccess                   — the public REST API (/api/v1) and
//                                 minting API keys
//
// `null` means unlimited.
// ============================================================

export type PlanId = 'trial' | 'starter' | 'growth';

export type LimitKey =
  | 'seats'
  | 'contacts'
  | 'broadcastRecipientsPerMonth'
  | 'automations'
  | 'flows';

export type FeatureKey = 'apiAccess';

export type PlanLimits = Record<LimitKey, number | null> &
  Record<FeatureKey, boolean>;

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Display price per month, in `PRICE_CURRENCY`. Null = free. */
  monthlyPrice: number | null;
  /** Env var holding the provider's recurring price id. Null = not purchasable. */
  priceEnv: string | null;
  limits: PlanLimits;
}

/**
 * Length of the free trial. The trial row itself is created in the
 * database (migration 034, `create_trial_subscription`), so changing
 * this number also needs the interval there changed.
 */
export const TRIAL_DAYS = 14;

/** Currency the placeholder prices are shown in. */
export const PRICE_CURRENCY = 'USD';

export const PLANS: Record<PlanId, Plan> = {
  trial: {
    id: 'trial',
    name: 'Free trial',
    tagline: `${TRIAL_DAYS} days to try everything, no card needed.`,
    monthlyPrice: null,
    priceEnv: null,
    limits: {
      seats: 3,
      contacts: 1_000,
      broadcastRecipientsPerMonth: 1_000,
      automations: 5,
      flows: 3,
      apiAccess: true,
    },
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    tagline: 'For small teams getting going on WhatsApp.',
    monthlyPrice: 29,
    priceEnv: 'STRIPE_PRICE_STARTER',
    limits: {
      seats: 3,
      contacts: 5_000,
      broadcastRecipientsPerMonth: 10_000,
      automations: 10,
      flows: 5,
      apiAccess: false,
    },
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    tagline: 'For growing teams that automate and integrate.',
    monthlyPrice: 99,
    priceEnv: 'STRIPE_PRICE_GROWTH',
    limits: {
      seats: 10,
      contacts: 50_000,
      broadcastRecipientsPerMonth: 100_000,
      automations: null,
      flows: null,
      apiAccess: true,
    },
  },
};

/** Plans a customer can buy, cheapest first. */
export const PAID_PLAN_IDS: readonly PlanId[] = ['starter', 'growth'];

/** Applied when billing is not enforced (no provider configured). */
export const UNLIMITED: PlanLimits = {
  seats: null,
  contacts: null,
  broadcastRecipientsPerMonth: null,
  automations: null,
  flows: null,
  apiAccess: true,
};

export const LIMIT_LABELS: Record<LimitKey, { noun: string; title: string }> = {
  seats: { noun: 'team seats', title: 'Team seats' },
  contacts: { noun: 'contacts', title: 'Contacts' },
  broadcastRecipientsPerMonth: {
    noun: 'campaign recipients this month',
    title: 'Campaign recipients this month',
  },
  automations: { noun: 'automations', title: 'Automations' },
  flows: { noun: 'flows', title: 'Flows' },
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && Object.hasOwn(PLANS, value);
}

export function isPaidPlanId(value: unknown): value is PlanId {
  return isPlanId(value) && PAID_PLAN_IDS.includes(value);
}

/** Server-side: the provider price id configured for a plan, if any. */
export function priceIdForPlan(plan: PlanId): string | null {
  const envName = PLANS[plan].priceEnv;
  if (!envName) return null;
  return process.env[envName]?.trim() || null;
}

/** Server-side: map a provider price id back to the plan it sells. */
export function planForPriceId(priceId: string | null): PlanId | null {
  if (!priceId) return null;
  for (const id of PAID_PLAN_IDS) {
    if (priceIdForPlan(id) === priceId) return id;
  }
  return null;
}
