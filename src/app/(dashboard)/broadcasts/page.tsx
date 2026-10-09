'use client';

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Broadcast, BroadcastStatus } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AlertCircle, Megaphone, Plus, RefreshCw, SearchX } from 'lucide-react';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { getBroadcastStatus } from '@/lib/broadcast-status';
import { formatRate, summarizeCampaigns } from '@/lib/analytics/compute';
import { PageHeader } from '@/components/layout/page-header';
import { Segmented, StatStrip } from '@/components/ui/stat';

/**
 * Poll cadence while any broadcast is sending. Kept modest so we don't
 * beat on Supabase — the aggregate trigger in migration 003 keeps
 * counts consistent; we just need to surface the freshest snapshot.
 */
const POLL_INTERVAL_MS = 5_000;

type StatusFilter = BroadcastStatus | 'all';

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'sending', label: 'Sending' },
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
];

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 100);
}

function RateCell({
  value,
  total,
  color,
}: {
  value: number;
  total: number;
  /** Tailwind bg class for the fill, e.g. "bg-primary" */
  color: string;
}) {
  // Nothing sent yet: a "0%" bar would read as a bad result rather
  // than "not measured", so show a dash instead.
  if (!total) {
    return <span className="text-xs text-muted-foreground">–</span>;
  }
  const pct = percent(value, total);
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 text-right text-xs text-foreground tabular-nums">
        {pct}%
      </span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function BroadcastsPage() {
  const router = useRouter();
  const canCreate = useCan('send-messages');
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Used to kick off polling only while something is actively sending.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBroadcasts = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;
      setBroadcasts(data ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBroadcasts();
  }, [fetchBroadcasts]);

  const anySending = useMemo(
    () => broadcasts.some((b) => b.status === 'sending'),
    [broadcasts],
  );

  useEffect(() => {
    function startPolling() {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(fetchBroadcasts, POLL_INTERVAL_MS);
    }
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }

    // Pause polling while the tab is hidden — keeps Supabase cold when
    // the user is away, and ensures a fresh fetch the moment they
    // refocus so they don't see stale data on return.
    function handleVisibilityChange() {
      if (!anySending) return;
      if (document.visibilityState === 'hidden') {
        stopPolling();
      } else {
        fetchBroadcasts();
        startPolling();
      }
    }

    if (anySending && document.visibilityState === 'visible') {
      startPolling();
    } else {
      stopPolling();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [anySending, fetchBroadcasts]);

  const summary = useMemo(() => summarizeCampaigns(broadcasts), [broadcasts]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: broadcasts.length };
    for (const b of broadcasts) counts[b.status] = (counts[b.status] ?? 0) + 1;
    return counts;
  }, [broadcasts]);

  const visible = useMemo(
    () =>
      statusFilter === 'all'
        ? broadcasts
        : broadcasts.filter((b) => b.status === statusFilter),
    [broadcasts, statusFilter],
  );

  const newCampaignButton = (
    <GatedButton
      canAct={canCreate}
      gateReason="create campaigns"
      onClick={() => router.push('/broadcasts/new')}
    >
      <Plus />
      New campaign
    </GatedButton>
  );

  return (
    <div className="space-y-5">
      {/* Top indeterminate progress bar: only visible while a broadcast
          is mid-send. Pure CSS animation so no extra deps. */}
      {anySending && (
        <div
          role="progressbar"
          aria-label="Campaign sending in progress"
          className="broadcast-indeterminate fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-muted"
        >
          <div className="broadcast-indeterminate-bar h-0.5 bg-primary" />
          <style jsx>{`
            .broadcast-indeterminate-bar {
              width: 33%;
              transform: translateX(-100%);
              animation: broadcast-slide 1.6s cubic-bezier(0.4, 0, 0.2, 1)
                infinite;
            }
            @keyframes broadcast-slide {
              0% {
                transform: translateX(-100%);
              }
              100% {
                transform: translateX(400%);
              }
            }
          `}</style>
        </div>
      )}

      <PageHeader
        title="Campaigns"
        description="Send approved WhatsApp templates to opted-in contacts and track delivery."
        actions={newCampaignButton}
      />

      {error ? (
        <div
          role="alert"
          className="flex flex-col items-center rounded-lg border border-border bg-card px-6 py-12 text-center"
        >
          <AlertCircle className="size-6 text-destructive" />
          <p className="mt-2 text-sm font-medium text-foreground">
            Couldn&apos;t load campaigns
          </p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setLoading(true);
              fetchBroadcasts();
            }}
          >
            <RefreshCw />
            Try again
          </Button>
        </div>
      ) : loading ? (
        <>
          <StatStrip
            loading
            items={[
              { label: 'Campaigns', value: '' },
              { label: 'Messages sent', value: '' },
              { label: 'Delivered', value: '' },
              { label: 'Read', value: '' },
            ]}
          />
          <div
            className="space-y-2 rounded-lg border border-border bg-card p-4"
            aria-busy="true"
            aria-label="Loading campaigns"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-muted" />
            ))}
          </div>
        </>
      ) : broadcasts.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-border bg-card px-6 py-14 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-primary-soft">
            <Megaphone className="size-5 text-primary" />
          </div>
          <p className="mt-3 text-sm font-semibold text-foreground">
            No campaigns yet
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            A campaign sends one approved template to a chosen audience.
            Contacts who have opted out are skipped automatically.
          </p>
          <div className="mt-4">{newCampaignButton}</div>
        </div>
      ) : (
        <>
          <StatStrip
            items={[
              {
                label: 'Campaigns',
                value: summary.campaigns.toLocaleString(),
                hint: `${(statusCounts.scheduled ?? 0).toLocaleString()} scheduled`,
              },
              {
                label: 'Messages sent',
                value: summary.sent.toLocaleString(),
                hint:
                  summary.failed > 0
                    ? `${summary.failed.toLocaleString()} failed`
                    : 'No failures',
                tone: summary.failed > 0 ? 'negative' : 'default',
              },
              {
                label: 'Delivered',
                value: formatRate(summary.deliveryRate),
                hint: `${summary.delivered.toLocaleString()} messages`,
              },
              {
                label: 'Read',
                value: formatRate(summary.readRate),
                hint: `${summary.replied.toLocaleString()} replies`,
              },
            ]}
          />

          <div className="max-w-full overflow-x-auto">
            <Segmented
              label="Filter campaigns by status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={STATUS_FILTERS.map((f) => ({
                ...f,
                count: statusCounts[f.value] ?? 0,
              }))}
            />
          </div>

          {visible.length === 0 ? (
            <div className="flex flex-col items-center rounded-lg border border-border bg-card px-6 py-12 text-center">
              <SearchX className="size-6 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium text-foreground">
                No {getBroadcastStatus(statusFilter).label.toLowerCase()}{' '}
                campaigns
              </p>
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className="mt-2 text-xs font-medium text-primary hover:underline"
              >
                Show all campaigns
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Campaign</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">
                      Recipients
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">
                      Delivered
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">Read</TableHead>
                    <TableHead className="hidden text-right xl:table-cell">
                      Replied
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      Created
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((broadcast) => {
                    const status = getBroadcastStatus(broadcast.status);
                    return (
                      <TableRow
                        key={broadcast.id}
                        className="cursor-pointer focus-visible:bg-muted/50 focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-inset"
                        role="button"
                        tabIndex={0}
                        aria-label={`Open campaign ${broadcast.name}`}
                        onClick={() =>
                          router.push(`/broadcasts/${broadcast.id}`)
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            router.push(`/broadcasts/${broadcast.id}`);
                          }
                        }}
                      >
                        <TableCell className="max-w-72">
                          <span className="block truncate font-medium text-foreground">
                            {broadcast.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            Template: {broadcast.template_name}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
                          >
                            {status.pulse && (
                              <span className="relative flex size-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
                                <span className="relative inline-flex size-1.5 rounded-full bg-warning" />
                              </span>
                            )}
                            {status.label}
                          </span>
                          {broadcast.status === 'scheduled' &&
                            broadcast.scheduled_at && (
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                {new Date(
                                  broadcast.scheduled_at,
                                ).toLocaleString(undefined, {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })}
                              </span>
                            )}
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums sm:table-cell">
                          {broadcast.total_recipients.toLocaleString()}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <RateCell
                            value={broadcast.delivered_count}
                            total={broadcast.sent_count}
                            color="bg-primary"
                          />
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          <RateCell
                            value={broadcast.read_count}
                            total={broadcast.sent_count}
                            color="bg-info"
                          />
                        </TableCell>
                        <TableCell className="hidden text-right tabular-nums xl:table-cell">
                          {broadcast.replied_count.toLocaleString()}
                        </TableCell>
                        <TableCell className="hidden text-muted-foreground sm:table-cell">
                          {new Date(broadcast.created_at).toLocaleDateString(
                            undefined,
                            { day: 'numeric', month: 'short', year: 'numeric' },
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
