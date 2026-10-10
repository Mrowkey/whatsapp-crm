"use client";

import Link from "next/link";
import { AlertTriangle, Clock, Lock } from "lucide-react";

import { useBilling } from "@/hooks/use-billing";
import { cn } from "@/lib/utils";

// Trial reminder starts this many days before the trial ends.
const TRIAL_REMINDER_DAYS = 3;

/**
 * Shell-wide plan notice, shown above every dashboard page:
 *
 *   read-only (trial over / subscription ended) → blocking notice
 *   payment failed (past due)                   → warning
 *   trial ending within a few days              → gentle reminder
 *
 * Renders nothing in every other state, including while loading and
 * when billing isn't enforced on this deployment.
 */
export function BillingBanner() {
  const { billing } = useBilling();
  if (!billing || !billing.enforced) return null;

  let tone: "blocked" | "warning" | "info";
  let Icon = Clock;
  let text: string;

  if (!billing.canWrite) {
    tone = "blocked";
    Icon = Lock;
    text =
      billing.state === "trial_expired"
        ? "Your free trial has ended. This workspace is read-only: you can still view everything, but sending and creating are paused."
        : "Your subscription is no longer active. This workspace is read-only: you can still view everything, but sending and creating are paused.";
  } else if (billing.state === "past_due") {
    tone = "warning";
    Icon = AlertTriangle;
    text =
      "Your last payment failed. Update your payment method to avoid losing access.";
  } else if (
    billing.state === "trialing" &&
    billing.trialDaysLeft !== null &&
    billing.trialDaysLeft <= TRIAL_REMINDER_DAYS
  ) {
    tone = "info";
    text =
      billing.trialDaysLeft <= 1
        ? "Your free trial ends today."
        : `Your free trial ends in ${billing.trialDaysLeft} days.`;
  } else {
    return null;
  }

  const action = !billing.canManage
    ? null
    : tone === "warning"
      ? "Update payment"
      : "Choose a plan";

  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5 text-sm sm:px-6",
        tone === "blocked" &&
          "border-destructive/20 bg-destructive/10 text-foreground",
        tone === "warning" && "border-warning/30 bg-warning-soft text-foreground",
        tone === "info" && "border-primary-soft-2 bg-primary-soft text-foreground",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          tone === "blocked" && "text-destructive",
          tone === "warning" && "text-warning",
          tone === "info" && "text-primary",
        )}
      />
      <p className="min-w-0 flex-1">
        {text}
        {!billing.canManage
          ? " Ask a workspace owner or admin to upgrade."
          : null}
      </p>
      {action ? (
        <Link
          href="/settings?tab=billing"
          className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          {action}
        </Link>
      ) : null}
    </div>
  );
}
