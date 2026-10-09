"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  INBOX_VIEWS,
  countInboxViews,
  formatConversationTime,
  matchesContactFilters,
  matchesInboxView,
  normalizeConversations,
  type InboxView,
} from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import {
  AlertCircle,
  ChevronDown,
  Inbox,
  RotateCw,
  Search,
  SearchX,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ContactAvatar } from "./contact-avatar";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
}

const VIEW_LABELS: Record<InboxView, string> = {
  all: "All",
  unread: "Unread",
  mine: "Mine",
  unassigned: "Unassigned",
};

type StatusFilter = ConversationStatus | "any";

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "Any status", value: "any" },
  { label: "Open", value: "open" },
  { label: "Pending", value: "pending" },
  { label: "Closed", value: "closed" },
];

const filterTriggerClass =
  "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-xs font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [view, setView] = useState<InboxView>("all");
  const [status, setStatus] = useState<StatusFilter>("any");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped by the error state's Retry button to refire the fetch.
  const [retryToken, setRetryToken] = useState(0);
  // Contact-based filters (issue #272). Tags use OR logic (a conversation
  // matches if its contact carries any selected tag), consistent with
  // Broadcast audience filtering. Company is an exact match on the field.
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Keep the latest callback in a ref so the fetch effect below can
  // have a stable identity. Previously the fetch depended on
  // `onConversationsLoaded`, which depends on the parent's
  // `deepLinkConvId` — so every URL change (including one the parent
  // triggered via router.replace after a click) caused a fresh
  // conversations fetch. That extra refetch was the trigger for the
  // deep-link auto-select running a second time and wiping the active
  // thread's messages.
  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        // Supabase errors have non-enumerable properties — log fields explicitly
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoadError(error.message || "Could not load conversations");
        setLoading(false);
        return;
      }

      setLoadError(null);
      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus — catches
    // up on any events sent while the WS was disconnected or throttled.
  }, [resyncToken, retryToken]);

  // Tag definitions for the filter picker — loaded once so labels/colours
  // stay stable regardless of which conversations happen to be loaded.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Company options are derived from the loaded conversations — there's no
  // separate companies table, and only companies with a live conversation
  // are worth offering as an inbox filter.
  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const viewCounts = useMemo(
    () => countInboxViews(conversations, user?.id),
    [conversations, user?.id],
  );

  const filtered = useMemo(() => {
    let result = conversations.filter((c) =>
      matchesInboxView(c, view, user?.id),
    );

    if (status !== "any") {
      result = result.filter((c) => c.status === status);
    }

    // Contact-based filters (tags via OR logic, exact company match).
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        }),
      );
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [
    conversations,
    view,
    status,
    search,
    selectedTagIds,
    selectedCompany,
    user?.id,
  ]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  }, []);

  const hasNarrowing =
    view !== "all" ||
    status !== "any" ||
    selectedTagIds.length > 0 ||
    selectedCompany !== null ||
    search.trim() !== "";

  const clearAllFilters = useCallback(() => {
    setView("all");
    setStatus("any");
    setSelectedTagIds([]);
    setSelectedCompany(null);
    setSearch("");
  }, []);

  const activeStatus = STATUS_FILTERS.find((o) => o.value === status);

  return (
    // w-full on mobile so the list occupies the whole viewport when it's
    // the single pane showing; fixed width on desktop where it shares the
    // row with the thread + contact sidebar.
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-[340px]">
      <div className="space-y-2.5 border-b border-border px-3 pt-3 pb-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, number or message"
            aria-label="Search conversations"
            className="h-8 w-full rounded-md border border-input bg-card pr-2.5 pl-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
          />
        </div>

        {/* View tabs with live counts. */}
        <div
          role="tablist"
          aria-label="Conversation views"
          className="-mx-1 flex gap-0.5 overflow-x-auto px-1"
        >
          {INBOX_VIEWS.map((v) => {
            const selected = view === v;
            return (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setView(v)}
                className={cn(
                  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  selected
                    ? "bg-primary-soft text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {VIEW_LABELS[v]}
                <span
                  className={cn(
                    "rounded px-1 text-[10px] leading-4 tabular-nums",
                    selected
                      ? "bg-primary-soft-2 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {viewCounts[v]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                filterTriggerClass,
                status !== "any" ? "text-primary" : "text-muted-foreground",
              )}
            >
              {activeStatus?.label ?? "Any status"}
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              {STATUS_FILTERS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setStatus(opt.value)}
                  className={cn(status === opt.value && "text-primary")}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {tags.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  filterTriggerClass,
                  selectedTagIds.length > 0
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              >
                Tags
                {selectedTagIds.length > 0 && (
                  <span className="rounded bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
                    {selectedTagIds.length}
                  </span>
                )}
                <ChevronDown className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 w-56">
                {tags.map((t) => (
                  <DropdownMenuCheckboxItem
                    key={t.id}
                    checked={selectedTagIds.includes(t.id)}
                    onCheckedChange={() => toggleTag(t.id)}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  filterTriggerClass,
                  "max-w-40",
                  selectedCompany ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className="truncate">{selectedCompany ?? "Company"}</span>
                <ChevronDown className="size-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 w-56">
                <DropdownMenuItem
                  onClick={() => setSelectedCompany(null)}
                  className={cn(selectedCompany === null && "text-primary")}
                >
                  All companies
                </DropdownMenuItem>
                {companies.map((co) => (
                  <DropdownMenuItem
                    key={co}
                    onClick={() => setSelectedCompany(co)}
                    className={cn(selectedCompany === co && "text-primary")}
                  >
                    <span className="truncate">{co}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {(selectedTagIds.length > 0 || selectedCompany) && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleTag(id)}
                  aria-label={`Remove tag filter ${tag?.name ?? ""}`}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-border"
                >
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: tag?.color ?? "var(--muted-foreground)",
                    }}
                  />
                  <span className="max-w-24 truncate">{tag?.name ?? "Tag"}</span>
                  <X className="size-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                type="button"
                onClick={() => setSelectedCompany(null)}
                aria-label={`Remove company filter ${selectedCompany}`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-border"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="size-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Conversation Items.
          `min-h-0` is load-bearing: a flex child defaults to
          min-height:auto, so without it this ScrollArea grows to fit
          every conversation instead of shrinking to the remaining
          space — the list then overflows and gets clipped by the
          parent's overflow-hidden with no scrollbar (issue #229). */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <ConversationListSkeleton />
        ) : loadError ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <p className="mt-2 text-sm font-medium text-foreground">
              Couldn&apos;t load conversations
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setRetryToken((n) => n + 1);
              }}
              className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 text-xs font-medium hover:bg-muted"
            >
              <RotateCw className="size-3" />
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            {hasNarrowing ? (
              <>
                <SearchX className="size-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  No matching conversations
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Nothing matches the current search and filters.
                </p>
                <button
                  type="button"
                  onClick={clearAllFilters}
                  className="mt-3 text-xs font-medium text-primary hover:underline"
                >
                  Clear search and filters
                </button>
              </>
            ) : (
              <>
                <Inbox className="size-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  No conversations yet
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  New WhatsApp messages from customers will appear here.
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className="flex flex-col">
            {filtered.map((conv) => (
              <li key={conv.id}>
                <ConversationItem
                  conversation={conv}
                  isActive={conv.id === activeConversationId}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}

function ConversationListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border/60 px-3 py-3"
        >
          <div className="size-9 shrink-0 animate-pulse rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
            <div className="h-2.5 w-4/5 animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

const STATUS_CHIP: Partial<Record<ConversationStatus, string>> = {
  pending: "bg-warning-soft text-warning",
  closed: "bg-muted text-muted-foreground",
};

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || "Unknown";
  const unread = conversation.unread_count > 0;
  const tags = contact?.tags ?? [];
  const statusChip = STATUS_CHIP[conversation.status];

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation)}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "relative flex w-full items-start gap-3 border-b border-border/60 px-3 py-2.5 text-left transition-colors focus-visible:bg-muted focus-visible:outline-none",
        isActive ? "bg-primary-soft" : "hover:bg-muted/60",
      )}
    >
      {isActive && (
        <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />
      )}
      <ContactAvatar name={displayName} avatarUrl={contact?.avatar_url} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={cn(
              "truncate text-sm text-foreground",
              unread ? "font-semibold" : "font-medium",
            )}
          >
            {displayName}
          </span>
          <span
            className={cn(
              "shrink-0 text-[11px] tabular-nums",
              unread ? "font-medium text-primary" : "text-muted-foreground",
            )}
          >
            {formatConversationTime(conversation.last_message_at)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p
            className={cn(
              "truncate text-xs",
              unread ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {conversation.last_message_text || "No messages yet"}
          </p>
          {unread && (
            <span
              aria-label={`${conversation.unread_count} unread`}
              className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums"
            >
              {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
            </span>
          )}
        </div>
        {(statusChip || tags.length > 0) && (
          <div className="mt-1.5 flex items-center gap-1 overflow-hidden">
            {statusChip && (
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 text-[10px] leading-4 font-medium capitalize",
                  statusChip,
                )}
              >
                {conversation.status}
              </span>
            )}
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag.id}
                className="inline-flex max-w-24 shrink-0 items-center gap-1 rounded bg-muted px-1.5 text-[10px] leading-4 text-muted-foreground"
              >
                <span
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="truncate">{tag.name}</span>
              </span>
            ))}
            {tags.length > 2 && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                +{tags.length - 2}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
