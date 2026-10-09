"use client";

import { useState, useEffect, useCallback, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatCurrency } from "@/lib/currency";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Building2,
  Check,
  Copy,
  Mail,
  Megaphone,
  Phone,
  ShieldAlert,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { toast } from "sonner";
import { ContactAvatar } from "./contact-avatar";
import { cn } from "@/lib/utils";

interface ContactSidebarProps {
  contact: Contact | null;
  /** Overrides the docked-panel framing, e.g. when rendered in a sheet. */
  className?: string;
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border px-4 py-3.5">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        {title}
        {count !== undefined && count > 0 && (
          <span className="rounded bg-muted px-1 text-[10px] leading-4 font-medium text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
      </h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function DetailRow({
  icon: Icon,
  children,
}: {
  icon: typeof Phone;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-7 items-center gap-2.5 text-[13px] text-foreground">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      {children}
    </div>
  );
}

export function ContactSidebar({ contact, className }: ContactSidebarProps) {
  const { accountId, defaultCurrency } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    try {
      await navigator.clipboard.writeText(contact.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy the number");
    }
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (error) {
      console.error("Failed to add note:", error);
      toast.error("Couldn't save the note");
    } else if (data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div
        className={cn(
          "flex h-full w-80 flex-col items-center justify-center border-l border-border bg-card px-6 text-center",
          className,
        )}
      >
        <UserRound className="size-6 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium text-foreground">
          Customer details
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Select a conversation to see the contact, tags, deals and notes.
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const openDeals = deals.filter((d) => (d.status ?? "open") === "open");
  const adHeadline = contact.ad_referral?.headline;

  return (
    <div
      className={cn(
        "flex h-full w-80 flex-col border-l border-border bg-card",
        className,
      )}
    >
      <ScrollArea className="min-h-0 flex-1">
        {/* Identity */}
        <div className="flex items-center gap-3 px-4 py-4">
          <ContactAvatar
            name={displayName}
            avatarUrl={contact.avatar_url}
            size="lg"
          />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {displayName}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Customer since{" "}
              {format(new Date(contact.created_at), "MMM d, yyyy")}
            </p>
          </div>
        </div>

        <Section title="Details">
          <div className="space-y-0.5">
            <DetailRow icon={Phone}>
              <span className="flex-1 truncate tabular-nums">
                {contact.phone}
              </span>
              <button
                type="button"
                onClick={handleCopyPhone}
                aria-label="Copy phone number"
                title="Copy phone number"
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {copied ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <Copy className="size-3.5" />
                )}
              </button>
            </DetailRow>
            {contact.email && (
              <DetailRow icon={Mail}>
                <span className="truncate">{contact.email}</span>
              </DetailRow>
            )}
            {contact.company && (
              <DetailRow icon={Building2}>
                <span className="truncate">{contact.company}</span>
              </DetailRow>
            )}
            {/* Marketing consent — Campaigns refuse to send to anyone
                with opted_in === false, so agents should see it here. */}
            {contact.opted_in === false ? (
              <DetailRow icon={ShieldAlert}>
                <span className="text-warning">
                  Opted out of campaign messages
                </span>
              </DetailRow>
            ) : contact.opted_in === true ? (
              <DetailRow icon={ShieldCheck}>
                <span>Opted in to campaign messages</span>
              </DetailRow>
            ) : null}
            {adHeadline && (
              <DetailRow icon={Megaphone}>
                <span className="truncate" title={adHeadline}>
                  From ad: {adHeadline}
                </span>
              </DetailRow>
            )}
          </div>
        </Section>

        <Section title="Tags" count={tags.length}>
          {tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tags yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <span
                  key={tag.contact_tag_id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] font-medium text-foreground"
                >
                  <span
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section title="Open deals" count={openDeals.length}>
          {openDeals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No open deals.</p>
          ) : (
            <div className="space-y-1.5">
              {openDeals.map((deal) => (
                <div
                  key={deal.id}
                  className="rounded-md border border-border px-2.5 py-2"
                >
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {deal.title}
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {formatCurrency(
                        deal.value,
                        deal.currency || defaultCurrency,
                      )}
                    </span>
                    {deal.stage && (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-1.5 rounded-full"
                          style={{ backgroundColor: deal.stage.color }}
                        />
                        {deal.stage.name}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Internal notes" count={notes.length}>
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note for your team"
            aria-label="New internal note"
            rows={2}
            className="w-full resize-none rounded-md border border-input bg-card px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          />
          <div className="mt-1.5 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddNote}
              disabled={!newNote.trim() || addingNote}
            >
              {addingNote ? "Saving…" : "Add note"}
            </Button>
          </div>

          {notes.length > 0 && (
            <ul className="mt-3 space-y-2">
              {notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-md bg-warning-soft px-2.5 py-2"
                >
                  <p className="text-[13px] break-words whitespace-pre-wrap text-foreground">
                    {note.note_text}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {format(new Date(note.created_at), "MMM d, yyyy 'at' HH:mm")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </ScrollArea>
    </div>
  );
}
