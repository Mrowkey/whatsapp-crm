import type { SupabaseClient } from '@supabase/supabase-js'
import { daysAgoStart } from '@/lib/dashboard/date-utils'
import type { ConversationsSeriesPoint } from '@/lib/dashboard/types'
import type { Broadcast } from '@/types'
import {
  computeMessageSeries,
  computeMessageTotals,
  computeResponseTimes,
  computeWorkload,
  summarizeCampaigns,
  type CampaignSummary,
  type MessageRow,
  type MessageTotals,
  type ResponseTimeStats,
  type WorkloadConversation,
  type WorkloadRow,
} from './compute'

type DB = SupabaseClient

/** PostgREST caps a single response (1,000 rows by default). */
const PAGE_SIZE = 1000
/** Upper bound on rows pulled for one report, to keep the tab responsive. */
export const ANALYTICS_ROW_CAP = 50_000

interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
}

/**
 * Page through a query until it is exhausted or `cap` rows are read.
 * Without this, any report over more than one page of rows would be
 * silently computed from the first 1,000 only. `truncated` is true
 * when the cap stopped the read, so the UI can say the figures are a
 * partial count instead of presenting them as complete.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
  cap: number = ANALYTICS_ROW_CAP,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  for (let from = 0; from < cap; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, cap) - 1
    const { data, error } = await page(from, to)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < to - from + 1) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

export type CampaignRow = Pick<
  Broadcast,
  | 'id'
  | 'name'
  | 'template_name'
  | 'status'
  | 'total_recipients'
  | 'sent_count'
  | 'delivered_count'
  | 'read_count'
  | 'replied_count'
  | 'failed_count'
  | 'created_at'
>

export interface AnalyticsReport {
  rangeDays: number
  messages: MessageTotals
  series: ConversationsSeriesPoint[]
  responseTime: ResponseTimeStats
  newConversations: number
  newContacts: number
  campaigns: CampaignRow[]
  campaignSummary: CampaignSummary
  workload: WorkloadRow[]
  /** True when a row cap was hit and message figures are a partial count. */
  truncated: boolean
}

/**
 * Everything the Analytics page shows for one date range. RLS scopes
 * every query to the signed-in user's account, so no account filter is
 * passed here (same convention as the dashboard queries).
 */
export async function loadAnalyticsReport(
  db: DB,
  rangeDays: number,
): Promise<AnalyticsReport> {
  const start = daysAgoStart(rangeDays - 1).toISOString()

  const [messages, newConversations, newContacts, campaigns, conversations, members] =
    await Promise.all([
      fetchAllRows<MessageRow>((from, to) =>
        db
          .from('messages')
          .select('conversation_id, sender_type, created_at, status')
          .gte('created_at', start)
          // `id` breaks ties so pages never overlap or skip rows.
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      ),
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', start),
      db
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', start),
      fetchAllRows<CampaignRow>((from, to) =>
        db
          .from('broadcasts')
          .select(
            'id, name, template_name, status, total_recipients, sent_count, delivered_count, read_count, replied_count, failed_count, created_at',
          )
          .gte('created_at', start)
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAllRows<WorkloadConversation>((from, to) =>
        db
          .from('conversations')
          .select('status, assigned_agent_id, unread_count')
          .order('id', { ascending: true })
          .range(from, to),
      ),
      db.from('profiles').select('user_id, full_name').order('full_name'),
    ])

  if (newConversations.error) throw new Error(newConversations.error.message)
  if (newContacts.error) throw new Error(newContacts.error.message)
  if (members.error) throw new Error(members.error.message)

  return {
    rangeDays,
    messages: computeMessageTotals(messages.rows),
    series: computeMessageSeries(messages.rows, rangeDays),
    responseTime: computeResponseTimes(messages.rows),
    newConversations: newConversations.count ?? 0,
    newContacts: newContacts.count ?? 0,
    campaigns: campaigns.rows,
    campaignSummary: summarizeCampaigns(campaigns.rows),
    workload: computeWorkload(
      conversations.rows,
      (members.data ?? []) as { user_id: string; full_name: string | null }[],
    ),
    truncated: messages.truncated || conversations.truncated,
  }
}
