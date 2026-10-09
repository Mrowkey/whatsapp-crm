// Pure aggregation for the Analytics page. Everything here takes rows
// already fetched from Supabase and returns display-ready numbers, so
// it can be unit-tested without a database. No value is ever
// fabricated: when there is nothing to measure the result is `null`
// (rendered as "No data"), never a placeholder number.

import { lastNDayKeys, localDayKey } from '@/lib/dashboard/date-utils'
import type { ConversationsSeriesPoint } from '@/lib/dashboard/types'
import type { Broadcast, ConversationStatus } from '@/types'

export interface MessageRow {
  conversation_id: string
  sender_type: string
  created_at: string
  status?: string | null
}

export interface MessageTotals {
  incoming: number
  outgoing: number
  /** Outbound messages whose delivery status is `failed`. */
  failedOutgoing: number
}

export function computeMessageTotals(rows: MessageRow[]): MessageTotals {
  const totals: MessageTotals = { incoming: 0, outgoing: 0, failedOutgoing: 0 }
  for (const row of rows) {
    if (row.sender_type === 'customer') {
      totals.incoming += 1
    } else {
      totals.outgoing += 1
      if (row.status === 'failed') totals.failedOutgoing += 1
    }
  }
  return totals
}

/** Per-local-day inbound/outbound counts, zero-filled across the range. */
export function computeMessageSeries(
  rows: MessageRow[],
  rangeDays: number,
): ConversationsSeriesPoint[] {
  const keys = lastNDayKeys(rangeDays)
  const buckets = new Map<string, { incoming: number; outgoing: number }>()
  for (const k of keys) buckets.set(k, { incoming: 0, outgoing: 0 })
  for (const row of rows) {
    const bucket = buckets.get(localDayKey(row.created_at))
    if (!bucket) continue
    if (row.sender_type === 'customer') bucket.incoming += 1
    else bucket.outgoing += 1
  }
  return keys.map((day) => ({ day, ...buckets.get(day)! }))
}

export interface ResponseTimeStats {
  /** Customer message → next outbound reply pairs found. */
  samples: number
  avgMinutes: number | null
  medianMinutes: number | null
  /** Share of replies sent within 5 minutes, 0–1. Null without samples. */
  within5MinRate: number | null
  /** Customer messages in range that have no later reply in range. */
  unanswered: number
}

/**
 * First-response times. Within each conversation, the first customer
 * message of an unanswered run is paired with the next outbound message
 * (agent or bot). A run of several customer messages counts once, so a
 * customer double-texting doesn't inflate the average.
 */
export function computeResponseTimes(rows: MessageRow[]): ResponseTimeStats {
  const byConversation = new Map<string, MessageRow[]>()
  for (const row of rows) {
    const list = byConversation.get(row.conversation_id)
    if (list) list.push(row)
    else byConversation.set(row.conversation_id, [row])
  }

  const minutes: number[] = []
  let unanswered = 0
  for (const list of byConversation.values()) {
    list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    let pending: number | null = null
    for (const row of list) {
      const ts = new Date(row.created_at).getTime()
      if (Number.isNaN(ts)) continue
      if (row.sender_type === 'customer') {
        if (pending === null) pending = ts
      } else if (pending !== null) {
        const diff = (ts - pending) / 60_000
        if (diff >= 0) minutes.push(diff)
        pending = null
      }
    }
    if (pending !== null) unanswered += 1
  }

  if (minutes.length === 0) {
    return {
      samples: 0,
      avgMinutes: null,
      medianMinutes: null,
      within5MinRate: null,
      unanswered,
    }
  }

  const sorted = [...minutes].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]

  return {
    samples: minutes.length,
    avgMinutes: minutes.reduce((a, b) => a + b, 0) / minutes.length,
    medianMinutes: median,
    within5MinRate: minutes.filter((m) => m <= 5).length / minutes.length,
    unanswered,
  }
}

export type CampaignCounts = Pick<
  Broadcast,
  | 'status'
  | 'total_recipients'
  | 'sent_count'
  | 'delivered_count'
  | 'read_count'
  | 'replied_count'
  | 'failed_count'
>

export interface CampaignSummary {
  campaigns: number
  recipients: number
  sent: number
  delivered: number
  read: number
  replied: number
  failed: number
  /** Rates are over messages actually sent; null when nothing was sent. */
  deliveryRate: number | null
  readRate: number | null
  replyRate: number | null
  failureRate: number | null
}

/** Safe ratio: null (not 0) when the denominator is empty. */
export function rate(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null
  return Math.min(1, Math.max(0, numerator / denominator))
}

export function summarizeCampaigns(rows: CampaignCounts[]): CampaignSummary {
  const sum = (pick: (r: CampaignCounts) => number | null | undefined) =>
    rows.reduce((total, r) => total + (pick(r) ?? 0), 0)

  const sent = sum((r) => r.sent_count)
  const delivered = sum((r) => r.delivered_count)
  const read = sum((r) => r.read_count)
  const replied = sum((r) => r.replied_count)
  const failed = sum((r) => r.failed_count)
  // Failures never reach `sent_count`, so attempts = sent + failed.
  const attempted = sent + failed

  return {
    campaigns: rows.length,
    recipients: sum((r) => r.total_recipients),
    sent,
    delivered,
    read,
    replied,
    failed,
    deliveryRate: rate(delivered, sent),
    readRate: rate(read, sent),
    replyRate: rate(replied, sent),
    failureRate: rate(failed, attempted),
  }
}

export interface WorkloadConversation {
  status: ConversationStatus
  assigned_agent_id?: string | null
  unread_count: number
}

export interface WorkloadRow {
  /** Null for the "Unassigned" row. */
  userId: string | null
  name: string
  open: number
  pending: number
  closed: number
  /** Conversations with at least one unread customer message. */
  unread: number
  total: number
}

/**
 * Current conversation load per teammate, plus an "Unassigned" row.
 * Teammates with no conversations are still listed so an idle agent is
 * visible. Sorted by active (open + pending) load, unassigned last.
 */
export function computeWorkload(
  conversations: WorkloadConversation[],
  members: { user_id: string; full_name: string | null }[],
): WorkloadRow[] {
  const blank = (userId: string | null, name: string): WorkloadRow => ({
    userId,
    name,
    open: 0,
    pending: 0,
    closed: 0,
    unread: 0,
    total: 0,
  })

  const rows = new Map<string, WorkloadRow>()
  for (const m of members) {
    rows.set(m.user_id, blank(m.user_id, m.full_name?.trim() || 'Unnamed teammate'))
  }
  const unassigned = blank(null, 'Unassigned')

  for (const c of conversations) {
    let row = unassigned
    if (c.assigned_agent_id) {
      row =
        rows.get(c.assigned_agent_id) ??
        // Assigned to someone no longer in the account's member list.
        rows
          .set(c.assigned_agent_id, blank(c.assigned_agent_id, 'Former teammate'))
          .get(c.assigned_agent_id)!
    }
    row[c.status] += 1
    row.total += 1
    if (c.unread_count > 0) row.unread += 1
  }

  const sorted = [...rows.values()].sort(
    (a, b) => b.open + b.pending - (a.open + a.pending) || a.name.localeCompare(b.name),
  )
  return [...sorted, unassigned]
}

/** "4m", "1h 12m", "2d 3h" — compact duration for response times. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null || Number.isNaN(minutes)) return 'No data'
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  if (hours < 24) return mins ? `${hours}h ${mins}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours ? `${days}d ${remHours}h` : `${days}d`
}

export function formatRate(value: number | null): string {
  if (value === null) return 'No data'
  return `${Math.round(value * 100)}%`
}
