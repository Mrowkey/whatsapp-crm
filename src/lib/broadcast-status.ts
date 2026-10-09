/**
 * Shared status badge config for broadcasts + recipients.
 *
 * Previously `statusConfig` was defined inline in both
 * /broadcasts/page.tsx and /broadcasts/[id]/page.tsx with slight
 * drift risk. One source of truth now.
 *
 * Badge shape: bg-*-500/10 + text-*-400 + border-*-500/20. The
 * translucent fills sit fine on both light and dark surfaces; neutral
 * statuses use text-muted-foreground so the label stays legible in
 * light mode (a solid slate-400 would be too faint on white).
 */

import type { BroadcastStatus, RecipientStatus } from "@/types";

export interface StatusDisplay {
  label: string;
  classes: string;
  /**
   * Set true for statuses that should pulse in the UI to convey
   * "live / in-flight" — currently only `sending`.
   */
  pulse?: boolean;
}

export const broadcastStatusConfig: Record<BroadcastStatus, StatusDisplay> = {
  draft: {
    label: "Draft",
    classes: "bg-muted text-muted-foreground border-transparent",
  },
  scheduled: {
    label: "Scheduled",
    classes: "bg-info-soft text-info border-transparent",
  },
  sending: {
    label: "Sending",
    classes: "bg-warning-soft text-warning border-transparent",
    pulse: true,
  },
  sent: {
    label: "Sent",
    classes: "bg-success-soft text-success border-transparent",
  },
  failed: {
    label: "Failed",
    classes: "bg-destructive/10 text-destructive border-transparent",
  },
};

export const recipientStatusConfig: Record<RecipientStatus, StatusDisplay> = {
  pending: {
    label: "Pending",
    classes: "bg-muted text-muted-foreground border-transparent",
  },
  sent: {
    label: "Sent",
    classes: "bg-info-soft text-info border-transparent",
  },
  delivered: {
    label: "Delivered",
    classes: "bg-success-soft text-success border-transparent",
  },
  read: {
    label: "Read",
    classes: "bg-success-soft text-success border-transparent",
  },
  replied: {
    label: "Replied",
    classes: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  failed: {
    label: "Failed",
    classes: "bg-destructive/10 text-destructive border-transparent",
  },
};

/**
 * Tolerant lookup — callers often have a generic string status
 * coming from Supabase. Falls back to the "draft" / "pending"
 * entry so the UI never crashes on an unknown value.
 */
export function getBroadcastStatus(status: string): StatusDisplay {
  return (
    broadcastStatusConfig[status as BroadcastStatus] ??
    broadcastStatusConfig.draft
  );
}

export function getRecipientStatus(status: string): StatusDisplay {
  return (
    recipientStatusConfig[status as RecipientStatus] ??
    recipientStatusConfig.pending
  );
}
