// ============================================================
// Entitlements — pure, unit-testable, no I/O.
//
// Turns an `account_subscriptions` row into "what may this account do
// right now": which plan's limits apply and whether the workspace is
// writable. Server guards (`./guard.ts`) and the Billing UI both read
// the result, so the rules live in exactly one place.
//
// Lifecycle → access
//   trialing (trial not over)  → writable, trial limits
//   trialing (trial over)      → READ-ONLY  ("trial_expired")
//   active                     → writable, plan limits
//   past_due                   → writable, plan limits (the provider is
//                                still retrying the card; show a warning)
//   canceled / unpaid / paused → READ-ONLY  ("canceled")
//
// Read-only means the app stays browsable but sending and creating
// are refused with a 402.
// ============================================================

import {
  LIMIT_LABELS,
  PLANS,
  UNLIMITED,
  isPlanId,
  type FeatureKey,
  type LimitKey,
  type PlanId,
  type PlanLimits,
} from './plans';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
];

/** The `account_subscriptions` row (migration 034). */
export interface SubscriptionRow {
  account_id: string;
  plan: string;
  status: SubscriptionStatus;
  provider: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_price_id: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider_event_at: string | null;
}

export type AccessState =
  /** Billing isn't switched on for this deployment — nothing is limited. */
  | 'unenforced'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'trial_expired'
  | 'canceled';

export interface Access {
  enforced: boolean;
  plan: PlanId;
  state: AccessState;
  /** False = read-only: sending and creating are refused. */
  canWrite: boolean;
  limits: PlanLimits;
  /** Whole days left in the trial (rounded up); null when not trialing. */
  trialDaysLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve an account's access.
 *
 * A missing row (`null`) is treated as an open trial: the row is
 * created by a database trigger, and a hiccup there must not lock a
 * paying-intent customer out of a workspace they just created.
 */
export function resolveAccess(
  sub: SubscriptionRow | null,
  opts: { enforced: boolean; now?: Date },
): Access {
  const now = opts.now ?? new Date();
  // An unrecognised plan id (config and data out of sync) gets the
  // most conservative limits rather than unlimited access.
  const plan: PlanId = sub && isPlanId(sub.plan) ? sub.plan : 'trial';

  if (!opts.enforced) {
    return {
      enforced: false,
      plan,
      state: 'unenforced',
      canWrite: true,
      limits: UNLIMITED,
      trialDaysLeft: null,
    };
  }

  const limits = PLANS[plan].limits;
  const base = { enforced: true, plan, limits } as const;

  if (!sub) {
    return { ...base, state: 'trialing', canWrite: true, trialDaysLeft: null };
  }

  switch (sub.status) {
    case 'trialing': {
      // A provider-side trial on a paid plan is simply an active plan.
      if (plan !== 'trial') {
        return { ...base, state: 'active', canWrite: true, trialDaysLeft: null };
      }
      const endsAt = sub.trial_ends_at ? Date.parse(sub.trial_ends_at) : NaN;
      if (Number.isNaN(endsAt)) {
        return { ...base, state: 'trialing', canWrite: true, trialDaysLeft: null };
      }
      const msLeft = endsAt - now.getTime();
      if (msLeft <= 0) {
        return { ...base, state: 'trial_expired', canWrite: false, trialDaysLeft: 0 };
      }
      return {
        ...base,
        state: 'trialing',
        canWrite: true,
        trialDaysLeft: Math.ceil(msLeft / DAY_MS),
      };
    }
    case 'active':
      return { ...base, state: 'active', canWrite: true, trialDaysLeft: null };
    case 'past_due':
      return { ...base, state: 'past_due', canWrite: true, trialDaysLeft: null };
    case 'canceled':
    case 'unpaid':
    case 'paused':
    default:
      return { ...base, state: 'canceled', canWrite: false, trialDaysLeft: null };
  }
}

// ------------------------------------------------------------
// Errors
// ------------------------------------------------------------

export type BillingErrorCode =
  /** Trial over or subscription ended — the workspace is read-only. */
  | 'subscription_inactive'
  /** A plan limit would be exceeded. */
  | 'limit_reached'
  /** The plan doesn't include this feature. */
  | 'feature_unavailable';

/**
 * Thrown by the server guards. Maps to HTTP 402 (Payment Required) so
 * clients can tell "you need to upgrade" apart from 403 "your role
 * can't do this".
 */
export class BillingError extends Error {
  readonly status = 402 as const;
  readonly code: BillingErrorCode;
  readonly details: {
    plan: PlanId;
    limit?: LimitKey;
    max?: number;
    used?: number;
  };

  constructor(
    code: BillingErrorCode,
    message: string,
    details: BillingError['details'],
  ) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    this.details = details;
  }
}

const UPGRADE_HINT = 'Upgrade in Settings → Billing';

/** Throws when the workspace is read-only. */
export function assertWritable(access: Access): void {
  if (access.canWrite) return;
  const message =
    access.state === 'trial_expired'
      ? `Your free trial has ended. ${UPGRADE_HINT} to keep sending and creating.`
      : `Your subscription is no longer active. ${UPGRADE_HINT} to keep sending and creating.`;
  throw new BillingError('subscription_inactive', message, { plan: access.plan });
}

/**
 * Throws when adding `adding` more of `key` on top of `used` would
 * exceed the plan. Also refuses when the workspace is read-only, so
 * callers need only this one check on a create path.
 */
export function assertLimit(
  access: Access,
  key: LimitKey,
  used: number,
  adding = 1,
): void {
  assertWritable(access);
  const max = access.limits[key];
  if (max === null) return;
  if (used + adding <= max) return;

  const { noun } = LIMIT_LABELS[key];
  const planName = PLANS[access.plan].name;
  const cap = max.toLocaleString('en-US');
  const message =
    adding > 1
      ? `This would take you over your ${planName} plan's limit of ${cap} ${noun} (${used.toLocaleString('en-US')} used, ${adding.toLocaleString('en-US')} more requested). ${UPGRADE_HINT} to raise it.`
      : `You've reached your ${planName} plan's limit of ${cap} ${noun}. ${UPGRADE_HINT} to raise it.`;
  throw new BillingError('limit_reached', message, {
    plan: access.plan,
    limit: key,
    max,
    used,
  });
}

/** Throws when the plan doesn't include `feature`. */
export function assertFeature(access: Access, feature: FeatureKey): void {
  if (access.limits[feature]) return;
  throw new BillingError(
    'feature_unavailable',
    `The public API is not included in the ${PLANS[access.plan].name} plan. ${UPGRADE_HINT} to use it.`,
    { plan: access.plan },
  );
}

/** How many more of `key` fit, or null when unlimited. Never negative. */
export function remaining(access: Access, key: LimitKey, used: number): number | null {
  const max = access.limits[key];
  if (max === null) return null;
  return Math.max(0, max - used);
}
