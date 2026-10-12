// ============================================================
// Browser-side pre-flight for a campaign send.
//
// A dashboard campaign writes its broadcast + recipient rows before
// the first message goes out, so a send the plan would refuse is best
// stopped up front — otherwise the user gets a campaign full of failed
// recipients instead of one clear reason.
//
// This is a courtesy check on fresh numbers, not the enforcement: the
// send route refuses with 402 regardless. If the plan can't be read it
// stays out of the way and lets the server decide.
// ============================================================

import { LIMIT_LABELS, PLANS } from './plans';
import type { BillingSummary } from './summary';

/** Why a campaign of `recipients` can't be sent, or null if it can. */
export function campaignBlockReason(
  billing: BillingSummary,
  recipients: number,
): string | null {
  if (!billing.enforced) return null;

  if (!billing.canWrite) {
    return billing.state === 'trial_expired'
      ? 'Your free trial has ended. Upgrade in Settings → Billing to send campaigns.'
      : 'Your subscription is no longer active. Upgrade in Settings → Billing to send campaigns.';
  }

  const max = billing.limits.broadcastRecipientsPerMonth;
  if (max === null) return null;

  const left = Math.max(0, max - billing.usage.broadcastRecipientsPerMonth);
  if (recipients <= left) return null;

  const { noun } = LIMIT_LABELS.broadcastRecipientsPerMonth;
  return `This campaign has ${recipients.toLocaleString('en-US')} recipients, but only ${left.toLocaleString('en-US')} of your ${max.toLocaleString('en-US')} ${noun} are left on the ${PLANS[billing.plan].name} plan. Upgrade in Settings → Billing, or send to a smaller audience.`;
}

/** Throws an Error carrying the reason when the campaign can't be sent. */
export async function assertCampaignAllowed(recipients: number): Promise<void> {
  let billing: BillingSummary;
  try {
    const res = await fetch('/api/billing', { cache: 'no-store' });
    if (!res.ok) return;
    billing = (await res.json()) as BillingSummary;
  } catch {
    return;
  }
  const reason = campaignBlockReason(billing, recipients);
  if (reason) throw new Error(reason);
}
