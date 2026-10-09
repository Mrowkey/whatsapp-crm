"use client"

import Link from 'next/link'
import { Megaphone } from 'lucide-react'
import type { CampaignSnapshot, InboxSummary } from '@/lib/dashboard/types'
import { formatRate, rate } from '@/lib/analytics/compute'
import { getBroadcastStatus } from '@/lib/broadcast-status'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

function CardShell({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string
  href: string
  linkLabel: string
  children: React.ReactNode
}) {
  return (
    <section className="flex h-full flex-col rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <Link href={href} className="text-xs font-medium text-primary hover:underline">
          {linkLabel}
        </Link>
      </header>
      {children}
    </section>
  )
}

const INBOX_ROWS: {
  key: keyof InboxSummary
  label: string
  hint: string
  dot: string
}[] = [
  { key: 'unread', label: 'Unread', hint: 'Customer is waiting on a reply', dot: 'bg-destructive' },
  { key: 'unassigned', label: 'Unassigned', hint: 'Active, with no owner yet', dot: 'bg-warning' },
  { key: 'open', label: 'Open', hint: 'Being handled', dot: 'bg-success' },
  { key: 'pending', label: 'Pending', hint: 'Waiting on the customer', dot: 'bg-info' },
  { key: 'closed', label: 'Closed', hint: 'Resolved', dot: 'bg-muted-foreground' },
]

/** Current conversation counts by handling state. */
export function InboxSummaryCard({
  data,
  loading,
}: {
  data: InboxSummary | null
  loading: boolean
}) {
  return (
    <CardShell title="Team inbox" href="/inbox" linkLabel="Open inbox">
      <ul className="divide-y divide-border">
        {INBOX_ROWS.map((row) => (
          <li key={row.key} className="flex items-center gap-3 px-4 py-2.5">
            <span className={cn('size-2 shrink-0 rounded-full', row.dot)} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{row.label}</p>
              <p className="truncate text-xs text-muted-foreground">{row.hint}</p>
            </div>
            {loading || !data ? (
              <Skeleton className="h-5 w-8" />
            ) : (
              <span className="text-sm font-semibold text-foreground tabular-nums">
                {data[row.key].toLocaleString()}
              </span>
            )}
          </li>
        ))}
      </ul>
    </CardShell>
  )
}

/** The latest campaigns with their delivery and read rates. */
export function RecentCampaignsCard({
  data,
  loading,
}: {
  data: CampaignSnapshot[] | null
  loading: boolean
}) {
  return (
    <CardShell title="Recent campaigns" href="/broadcasts" linkLabel="All campaigns">
      {loading || !data ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-8 text-center">
          <Megaphone className="size-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium text-foreground">No campaigns yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Send an approved template to a group of opted-in contacts.
          </p>
          <Link
            href="/broadcasts/new"
            className="mt-3 text-xs font-medium text-primary hover:underline"
          >
            Create a campaign
          </Link>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {data.map((c) => {
            const status = getBroadcastStatus(c.status)
            return (
              <li key={c.id}>
                <Link
                  href={`/broadcasts/${c.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground tabular-nums">
                      {c.sent_count.toLocaleString()} of {c.total_recipients.toLocaleString()} sent
                      {c.sent_count > 0 && (
                        <>
                          {' · '}
                          {formatRate(rate(c.delivered_count, c.sent_count))} delivered
                          {' · '}
                          {formatRate(rate(c.read_count, c.sent_count))} read
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                  >
                    {status.label}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </CardShell>
  )
}
