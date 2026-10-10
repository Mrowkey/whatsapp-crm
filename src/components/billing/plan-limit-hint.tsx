"use client";

import Link from "next/link";

import { useBilling } from "@/hooks/use-billing";
import { LIMIT_LABELS, PLANS, type LimitKey } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

/**
 * Inline "N of M used" hint for one plan limit, placed next to the
 * thing it limits (invite button, contact list, campaign send step).
 *
 * Quiet until it matters: hidden while usage is under 80% of the
 * limit, amber from there, red with an upgrade link at the limit.
 * Pass `adding` to preview an action ("this campaign would use 400").
 * Renders nothing when billing isn't enforced or the limit is
 * unlimited. This is a hint only — the server enforces.
 */
export function PlanLimitHint({
  limit,
  adding = 0,
  className,
}: {
  limit: LimitKey;
  adding?: number;
  className?: string;
}) {
  const { billing } = useBilling();
  if (!billing || !billing.enforced || !billing.canWrite) return null;

  const max = billing.limits[limit];
  if (max === null) return null;

  const used = billing.usage[limit];
  const projected = used + adding;
  const over = adding > 0 ? projected > max : used >= max;
  if (!over && projected < max * 0.8) return null;

  const { noun } = LIMIT_LABELS[limit];
  const planName = PLANS[billing.plan].name;

  return (
    <p
      className={cn(
        "text-xs",
        over ? "text-destructive" : "text-warning",
        className,
      )}
    >
      {adding > 0 && over
        ? `This needs ${adding.toLocaleString()} but only ${Math.max(0, max - used).toLocaleString()} of ${max.toLocaleString()} ${noun} are left on the ${planName} plan.`
        : `${used.toLocaleString()} of ${max.toLocaleString()} ${noun} used on the ${planName} plan.`}
      {billing.canManage ? (
        <>
          {" "}
          <Link
            href="/settings?tab=billing"
            className="font-medium underline underline-offset-2"
          >
            Upgrade
          </Link>
        </>
      ) : null}
    </p>
  );
}
