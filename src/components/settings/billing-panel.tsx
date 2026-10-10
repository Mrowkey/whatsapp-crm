'use client';

// ============================================================
// BillingPanel — Settings → Billing (owner / admin).
//
// Shows the workspace's plan, where it is in its lifecycle, usage
// against each limit, and the two ways to act: start a subscription
// (hosted checkout) or manage an existing one (hosted portal).
//
// Nothing here changes the plan directly. Both buttons hand off to the
// payment provider; the plan updates when its webhook lands, which is
// why returning from checkout polls for a few seconds.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Check, CreditCard, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { useBilling } from '@/hooks/use-billing';
import {
  LIMIT_LABELS,
  PAID_PLAN_IDS,
  PLANS,
  PRICE_CURRENCY,
  type LimitKey,
  type Plan,
  type PlanId,
} from '@/lib/billing/plans';
import type { BillingSummary } from '@/lib/billing/summary';
import { cn } from '@/lib/utils';
import { SettingsChip, type ChipVariant } from './settings-chip';
import { SettingsPanelHead } from './settings-panel-head';

const LIMIT_ORDER: LimitKey[] = [
  'seats',
  'contacts',
  'broadcastRecipientsPerMonth',
  'automations',
  'flows',
];

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtPrice(plan: Plan): string {
  if (plan.monthlyPrice === null) return 'Free';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: PRICE_CURRENCY,
    maximumFractionDigits: 0,
  }).format(plan.monthlyPrice);
}

function fmtLimit(value: number | null): string {
  return value === null ? 'Unlimited' : value.toLocaleString();
}

function statusChip(b: BillingSummary): { variant: ChipVariant; label: string } {
  switch (b.state) {
    case 'trialing':
      return { variant: 'admin', label: 'Trial' };
    case 'active':
      return b.cancelAtPeriodEnd
        ? { variant: 'warn', label: 'Cancels at period end' }
        : { variant: 'ok', label: 'Active' };
    case 'past_due':
      return { variant: 'warn', label: 'Payment failed' };
    case 'trial_expired':
      return { variant: 'warn', label: 'Trial ended' };
    case 'canceled':
      return { variant: 'warn', label: 'Canceled' };
    case 'unenforced':
      return { variant: 'muted', label: 'Not enforced' };
  }
}

function statusLine(b: BillingSummary): string {
  switch (b.state) {
    case 'trialing': {
      const end = fmtDate(b.trialEndsAt);
      if (b.trialDaysLeft === null || !end) return 'You are on the free trial.';
      return `${b.trialDaysLeft} day${b.trialDaysLeft === 1 ? '' : 's'} left — the trial ends on ${end}.`;
    }
    case 'active': {
      const end = fmtDate(b.currentPeriodEnd);
      if (!end) return 'Your subscription is active.';
      return b.cancelAtPeriodEnd
        ? `Your subscription ends on ${end} and will not renew.`
        : `Renews on ${end}.`;
    }
    case 'past_due':
      return 'Your last payment failed. Update your payment method to keep your plan.';
    case 'trial_expired':
      return 'Your free trial has ended. The workspace is read-only until you choose a plan.';
    case 'canceled':
      return 'Your subscription has ended. The workspace is read-only until you choose a plan.';
    case 'unenforced':
      return 'Billing is not switched on for this deployment, so no limits apply.';
  }
}

function UsageRow({
  label,
  used,
  max,
}: {
  label: string;
  used: number;
  max: number | null;
}) {
  const ratio = max === null || max === 0 ? 0 : Math.min(1, used / max);
  const over = max !== null && used >= max;
  const near = max !== null && !over && ratio >= 0.8;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-foreground">{label}</span>
        <span
          className={cn(
            'tabular-nums text-muted-foreground',
            over && 'font-medium text-destructive',
          )}
        >
          {used.toLocaleString()} / {fmtLimit(max)}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max ?? undefined}
        aria-valuenow={used}
      >
        <div
          className={cn(
            'h-full rounded-full',
            over ? 'bg-destructive' : near ? 'bg-warning' : 'bg-primary',
          )}
          style={{ width: `${max === null ? 0 : Math.max(ratio * 100, used > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  current,
  purchasable,
  billing,
  busy,
  onChoose,
  onManage,
}: {
  plan: Plan;
  current: boolean;
  purchasable: boolean;
  billing: BillingSummary;
  busy: boolean;
  onChoose: () => void;
  onManage: () => void;
}) {
  const features: string[] = [
    `${fmtLimit(plan.limits.seats)} team seats`,
    `${fmtLimit(plan.limits.contacts)} contacts`,
    `${fmtLimit(plan.limits.broadcastRecipientsPerMonth)} campaign recipients / month`,
    `${fmtLimit(plan.limits.automations)} automations`,
    `${fmtLimit(plan.limits.flows)} flows`,
    plan.limits.apiAccess ? 'Public API access' : 'No public API access',
  ];

  // With a live subscription, every plan change goes through the
  // portal — a second checkout would bill the customer twice.
  const viaPortal = billing.hasPaidSubscription;

  return (
    <Card
      className={cn(
        'gap-0 px-5 py-5',
        current && 'ring-2 ring-primary',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{plan.name}</h3>
        {current ? <SettingsChip variant="admin">Current plan</SettingsChip> : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
      <p className="mt-4 text-foreground">
        <span className="text-3xl font-semibold tracking-tight">
          {fmtPrice(plan)}
        </span>
        <span className="text-sm text-muted-foreground"> / month</span>
      </p>
      <ul className="mt-4 space-y-2 text-sm text-foreground">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5">
        {current && billing.state !== 'canceled' ? (
          <Button variant="outline" className="w-full" disabled>
            Current plan
          </Button>
        ) : viaPortal ? (
          <Button
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={onManage}
          >
            Switch in billing portal
          </Button>
        ) : (
          <Button
            className="w-full"
            disabled={busy || !purchasable}
            onClick={onChoose}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {purchasable ? `Choose ${plan.name}` : 'Not available yet'}
          </Button>
        )}
      </div>
    </Card>
  );
}

function BillingPanelInner() {
  const { billing, loading, refresh } = useBilling();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<PlanId | 'portal' | null>(null);
  // Back from hosted checkout (`?checkout=success|canceled`). Read once
  // at mount: the param is stripped from the URL straight away, and the
  // effect below must not restart (and cancel its own polling) when
  // that changes the search params.
  const [returnedFrom] = useState(() => searchParams.get('checkout'));
  const [confirming, setConfirming] = useState(returnedFrom === 'success');
  const handledReturn = useRef(false);

  useEffect(() => {
    if (!returnedFrom || handledReturn.current) return;
    handledReturn.current = true;

    const params = new URLSearchParams(window.location.search);
    params.delete('checkout');
    router.replace(`/settings?${params.toString()}`, { scroll: false });

    if (returnedFrom !== 'success') {
      toast.info('Checkout canceled — nothing was charged.');
      return;
    }

    // The webhook, not this redirect, is what upgrades the plan — poll
    // briefly until it shows up.
    void (async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const next = await refresh();
        if (next?.hasPaidSubscription) {
          toast.success(`You're on the ${PLANS[next.plan].name} plan.`);
          setConfirming(false);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      setConfirming(false);
      toast.info(
        'Payment received. Your plan will update here in a moment — refresh if it has not.',
      );
    })();
  }, [returnedFrom, refresh, router]);

  async function go(endpoint: 'checkout' | 'portal', plan?: PlanId) {
    setBusy(plan ?? 'portal');
    try {
      const res = await fetch(`/api/billing/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan ? { plan } : {}),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (!res.ok || !payload.url) {
        toast.error(payload.error || 'Could not open billing');
        setBusy(null);
        return;
      }
      // Leave `busy` set: the page is navigating away.
      window.location.assign(payload.url);
    } catch (err) {
      console.error('[BillingPanel] request error:', err);
      toast.error('Could not reach the server');
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading billing…
      </div>
    );
  }

  if (!billing) {
    return (
      <Card className="px-5 py-5 text-sm text-muted-foreground">
        Billing details could not be loaded. Refresh the page to try again.
      </Card>
    );
  }

  const plan = PLANS[billing.plan];
  const chip = statusChip(billing);

  return (
    <div className="space-y-6">
      {!billing.configured ? (
        <Card className="px-5 py-4 text-sm text-muted-foreground">
          Payments are not configured on this deployment yet, so plans cannot
          be purchased and no limits are enforced. The plans below show what
          will apply once billing is switched on.
        </Card>
      ) : null}

      {/* Current plan */}
      <Card className="gap-0 px-5 py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-foreground">
                {plan.name}
              </h3>
              <SettingsChip variant={chip.variant}>{chip.label}</SettingsChip>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {confirming
                ? 'Confirming your payment…'
                : statusLine(billing)}
            </p>
          </div>
          {billing.hasCustomer ? (
            <Button
              variant="outline"
              className="shrink-0"
              disabled={busy !== null}
              onClick={() => void go('portal')}
            >
              {busy === 'portal' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CreditCard className="size-4" />
              )}
              Manage billing
            </Button>
          ) : null}
        </div>

        <div className="mt-5 grid gap-x-8 gap-y-4 border-t border-border pt-5 sm:grid-cols-2">
          {LIMIT_ORDER.map((key) => (
            <UsageRow
              key={key}
              label={LIMIT_LABELS[key].title}
              used={billing.usage[key]}
              max={billing.limits[key]}
            />
          ))}
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-foreground">Public API</span>
            <span className="text-muted-foreground">
              {billing.limits.apiAccess ? 'Included' : 'Not included'}
            </span>
          </div>
        </div>
      </Card>

      {/* Plans */}
      <div>
        <h3 className="text-sm font-semibold text-foreground">Plans</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Billed monthly per workspace. Change or cancel any time from Manage
          billing.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {PAID_PLAN_IDS.map((id) => (
            <PlanCard
              key={id}
              plan={PLANS[id]}
              current={billing.plan === id}
              purchasable={
                billing.configured && billing.purchasablePlans.includes(id)
              }
              billing={billing}
              busy={busy !== null}
              onChoose={() => void go('checkout', id)}
              onManage={() => void go('portal')}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function BillingPanel() {
  const { profileLoading } = useAuth();
  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Billing"
        description="Your workspace's plan, usage and payment details. Billing is per workspace, not per teammate."
      />
      <RequireRole
        min="admin"
        fallback={
          // RequireRole also shows the fallback while the role is still
          // loading; don't flash "admins only" at an admin.
          profileLoading ? null : (
            <Card className="px-5 py-5 text-sm text-muted-foreground">
              Only workspace owners and admins can view and manage billing.
            </Card>
          )
        }
      >
        <BillingPanelInner />
      </RequireRole>
    </section>
  );
}
