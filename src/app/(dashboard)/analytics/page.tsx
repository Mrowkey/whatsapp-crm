"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Megaphone, RefreshCw, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ANALYTICS_ROW_CAP,
  loadAnalyticsReport,
  type AnalyticsReport,
} from "@/lib/analytics/queries";
import {
  formatMinutes,
  formatRate,
  rate,
  type WorkloadRow,
} from "@/lib/analytics/compute";
import { getBroadcastStatus } from "@/lib/broadcast-status";
import { PageHeader } from "@/components/layout/page-header";
import { Segmented, StatStrip, type StatItem } from "@/components/ui/stat";
import { Button } from "@/components/ui/button";
import { ConversationsChart } from "@/components/dashboard/conversations-chart";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Skeleton } from "@/components/dashboard/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RangeDays = 7 | 30 | 90;

const RANGE_OPTIONS: { value: RangeDays; label: string }[] = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: AnalyticsReport };

export default function AnalyticsPage() {
  const [range, setRange] = useState<RangeDays>(30);
  // Reports are cached per range so flipping back is instant; `reloadKey`
  // invalidates the cache when the user asks for fresh numbers.
  const [reports, setReports] = useState<Partial<Record<RangeDays, LoadState>>>(
    {},
  );
  const [reloadKey, setReloadKey] = useState(0);

  const state: LoadState = reports[range] ?? { status: "loading" };

  useEffect(() => {
    let cancelled = false;
    loadAnalyticsReport(createClient(), range)
      .then((report) => {
        if (cancelled) return;
        setReports((prev) => ({ ...prev, [range]: { status: "ready", report } }));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error("[analytics] report failed:", err);
        setReports((prev) => ({
          ...prev,
          [range]: {
            status: "error",
            message:
              err instanceof Error ? err.message : "Could not load analytics",
          },
        }));
      });
    return () => {
      cancelled = true;
    };
  }, [range, reloadKey]);

  const handleRangeChange = useCallback(
    (next: RangeDays) => {
      setRange(next);
      // Retry automatically when returning to a range that failed.
      if (reports[next]?.status === "error") {
        setReports((prev) => ({ ...prev, [next]: { status: "loading" } }));
        setReloadKey((n) => n + 1);
      }
    },
    [reports],
  );

  const handleRefresh = useCallback(() => {
    setReports({});
    setReloadKey((n) => n + 1);
  }, []);

  const loading = state.status === "loading";
  const report = state.status === "ready" ? state.report : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Analytics"
        description="Conversation, campaign and team figures from your live workspace data."
        actions={
          <>
            <Segmented
              label="Date range"
              value={range}
              onChange={handleRangeChange}
              options={RANGE_OPTIONS}
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              disabled={loading}
              aria-label="Refresh analytics"
              title="Refresh"
            >
              <RefreshCw className={loading ? "animate-spin" : undefined} />
            </Button>
          </>
        }
      />

      {state.status === "error" ? (
        <div
          role="alert"
          className="flex flex-col items-center rounded-lg border border-border bg-card px-6 py-12 text-center"
        >
          <AlertCircle className="size-6 text-destructive" />
          <p className="mt-2 text-sm font-medium text-foreground">
            Couldn&apos;t load analytics
          </p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            {state.message}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={handleRefresh}
          >
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : (
        <>
          {report?.truncated && (
            <p
              role="status"
              className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning"
            >
              This range holds more than {ANALYTICS_ROW_CAP.toLocaleString()}{" "}
              rows, so message and workload figures below are a partial count.
              Pick a shorter range for exact numbers.
            </p>
          )}

          <ConversationStats report={report} loading={loading} />

          <ConversationsChart
            title="Message volume"
            series={{
              7: null,
              30: null,
              90: null,
              [range]: report?.series ?? null,
            }}
            loading={loading}
            range={range}
            onRangeChange={handleRangeChange}
            hideRangeTabs
          />

          <CampaignSection report={report} loading={loading} />

          <TeamSection rows={report?.workload ?? null} loading={loading} />
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------

function ConversationStats({
  report,
  loading,
}: {
  report: AnalyticsReport | null;
  loading: boolean;
}) {
  const rt = report?.responseTime;
  const items: StatItem[] = [
    {
      label: "Messages received",
      value: (report?.messages.incoming ?? 0).toLocaleString(),
      hint: `${(report?.newConversations ?? 0).toLocaleString()} new conversations`,
    },
    {
      label: "Messages sent",
      value: (report?.messages.outgoing ?? 0).toLocaleString(),
      hint:
        report && report.messages.failedOutgoing > 0
          ? `${report.messages.failedOutgoing.toLocaleString()} failed to deliver`
          : "No failed sends",
      tone:
        report && report.messages.failedOutgoing > 0 ? "negative" : "default",
    },
    {
      label: "Median first response",
      value: formatMinutes(rt?.medianMinutes ?? null),
      hint: rt?.samples
        ? `Average ${formatMinutes(rt.avgMinutes)} over ${rt.samples.toLocaleString()} replies`
        : "No replies in this range",
    },
    {
      label: "Replied within 5 min",
      value: formatRate(rt?.within5MinRate ?? null),
      hint:
        rt && rt.unanswered > 0
          ? `${rt.unanswered.toLocaleString()} conversations awaiting a reply`
          : "Nothing awaiting a reply",
      tone: rt && rt.unanswered > 0 ? "warning" : "default",
    },
    {
      label: "New contacts",
      value: (report?.newContacts ?? 0).toLocaleString(),
      hint: "Created in this range",
    },
  ];

  return (
    <section aria-label="Conversation summary">
      <StatStrip items={items} loading={loading} />
    </section>
  );
}

// ------------------------------------------------------------

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function RateBar({ value }: { value: number | null }) {
  if (value === null) {
    // Nothing sent yet, so there is no rate to show.
    return (
      <span
        className="block text-right text-xs text-muted-foreground"
        title="Nothing sent yet"
      >
        –
      </span>
    );
  }
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center justify-end gap-2">
      <div
        className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted xl:block"
        aria-hidden
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 text-right text-xs text-foreground tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

function CampaignSection({
  report,
  loading,
}: {
  report: AnalyticsReport | null;
  loading: boolean;
}) {
  const summary = report?.campaignSummary;
  const campaigns = report?.campaigns ?? [];

  return (
    <SectionCard
      title="Campaign performance"
      description="Campaigns created in this range. Rates are a share of messages sent."
      action={
        <Link
          href="/broadcasts"
          className="text-xs font-medium text-primary hover:underline"
        >
          All campaigns
        </Link>
      }
    >
      {loading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={Megaphone}
            title="No campaigns in this range"
            hint="Campaign delivery, read and reply rates appear here once a campaign is created."
          />
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-border px-4 py-3 sm:grid-cols-5">
            {[
              ["Messages sent", (summary?.sent ?? 0).toLocaleString()],
              ["Delivered", formatRate(summary?.deliveryRate ?? null)],
              ["Read", formatRate(summary?.readRate ?? null)],
              ["Replied", formatRate(summary?.replyRate ?? null)],
              ["Failed", formatRate(summary?.failureRate ?? null)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-base font-semibold text-foreground tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Read</TableHead>
                  <TableHead className="text-right">Replied</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => {
                  const status = getBroadcastStatus(c.status);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="max-w-64">
                        <Link
                          href={`/broadcasts/${c.id}`}
                          className="block truncate font-medium text-foreground hover:text-primary hover:underline"
                        >
                          {c.name}
                        </Link>
                        <span className="block truncate text-xs text-muted-foreground">
                          {new Date(c.created_at).toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}{" "}
                          · {c.template_name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                        >
                          {status.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.sent_count.toLocaleString()}
                        <span className="text-muted-foreground">
                          {" "}
                          / {c.total_recipients.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <RateBar value={rate(c.delivered_count, c.sent_count)} />
                      </TableCell>
                      <TableCell>
                        <RateBar value={rate(c.read_count, c.sent_count)} />
                      </TableCell>
                      <TableCell>
                        <RateBar value={rate(c.replied_count, c.sent_count)} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span
                          className={
                            c.failed_count > 0
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }
                        >
                          {c.failed_count.toLocaleString()}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </SectionCard>
  );
}

// ------------------------------------------------------------

function TeamSection({
  rows,
  loading,
}: {
  rows: WorkloadRow[] | null;
  loading: boolean;
}) {
  const hasConversations = rows?.some((r) => r.total > 0) ?? false;

  return (
    <SectionCard
      title="Team workload"
      description="Conversations currently assigned to each teammate, by status. Not affected by the date range."
    >
      {loading || !rows ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : !hasConversations ? (
        <div className="p-4">
          <EmptyState
            icon={Users}
            title="No conversations to assign yet"
            hint="Once customers message you, each teammate's open, pending and closed conversations appear here."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Teammate</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="text-right">Closed</TableHead>
                <TableHead className="text-right">With unread</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.userId ?? "unassigned"}>
                  <TableCell
                    className={
                      row.userId === null
                        ? "text-muted-foreground italic"
                        : "font-medium text-foreground"
                    }
                  >
                    {row.name}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.open.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.pending.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {row.closed.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span className={row.unread > 0 ? "text-warning" : undefined}>
                      {row.unread.toLocaleString()}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {row.total.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Per-agent reply counts and response times aren&apos;t shown because
            messages are not yet recorded against the agent who sent them.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
