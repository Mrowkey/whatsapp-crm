import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}

/**
 * Top-level Inbox views. `mine` / `unassigned` slice by assignment,
 * `unread` by unread count; `all` is everything. Orthogonal to the
 * status filter (open / pending / closed), which is applied separately.
 */
export type InboxView = "all" | "unread" | "mine" | "unassigned";

export const INBOX_VIEWS: readonly InboxView[] = [
  "all",
  "unread",
  "mine",
  "unassigned",
];

export function matchesInboxView(
  conversation: Conversation,
  view: InboxView,
  currentUserId: string | null | undefined,
): boolean {
  switch (view) {
    case "unread":
      return conversation.unread_count > 0;
    case "mine":
      return (
        !!currentUserId && conversation.assigned_agent_id === currentUserId
      );
    case "unassigned":
      return !conversation.assigned_agent_id;
    default:
      return true;
  }
}

/** Per-view conversation counts for the Inbox view tabs. */
export function countInboxViews(
  conversations: Conversation[],
  currentUserId: string | null | undefined,
): Record<InboxView, number> {
  const counts: Record<InboxView, number> = {
    all: 0,
    unread: 0,
    mine: 0,
    unassigned: 0,
  };
  for (const c of conversations) {
    for (const view of INBOX_VIEWS) {
      if (matchesInboxView(c, view, currentUserId)) counts[view] += 1;
    }
  }
  return counts;
}

/**
 * Compact timestamp for a conversation row: "now", "5m", "3h", then the
 * weekday within the last week, then a short date. `now` is injectable
 * for tests.
 */
export function formatConversationTime(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "";
  const then = new Date(iso);
  const diffMs = now.getTime() - then.getTime();
  if (Number.isNaN(diffMs)) return "";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return then.toLocaleDateString(undefined, { weekday: "short" });
  }
  return then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(then.getFullYear() !== now.getFullYear() ? { year: "2-digit" } : {}),
  });
}
