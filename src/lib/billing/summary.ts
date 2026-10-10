// Wire shape of GET /api/billing — shared by the route and the UI.

import type { AccessState } from './entitlements';
import type { LimitKey, PlanId, PlanLimits } from './plans';

export interface BillingSummary {
  /** A payment provider is configured on this deployment. */
  configured: boolean;
  /** Limits are being enforced (false = everything unlimited). */
  enforced: boolean;
  /** The caller may start checkout / open the billing portal (admin+). */
  canManage: boolean;
  plan: PlanId;
  state: AccessState;
  canWrite: boolean;
  limits: PlanLimits;
  usage: Record<LimitKey, number>;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** A live provider subscription exists — change plan via the portal. */
  hasPaidSubscription: boolean;
  /** The account has a provider customer, so the portal can be opened. */
  hasCustomer: boolean;
  /** Paid plans whose price id is configured. */
  purchasablePlans: PlanId[];
}
