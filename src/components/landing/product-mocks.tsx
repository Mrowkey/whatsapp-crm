import { Check, CheckCheck, Search, Send, StickyNote, Zap } from "lucide-react";

import { cn } from "@/lib/utils";

// Static, illustrative previews for the landing page. They borrow the
// app's own tokens (bubbles, chat canvas, status colours) so they track
// the real UI in both modes, but every name and message here is made up.

const CONVERSATIONS = [
  { name: "Meera Nair", preview: "Is the 2 BHK still available?", time: "10:42", unread: 2, active: true },
  { name: "Daniel Okafor", preview: "Thanks, payment sent.", time: "10:15", unread: 0, active: false },
  { name: "Sara Lindqvist", preview: "Can we move the visit to Friday?", time: "09:58", unread: 1, active: false },
  { name: "Imran Sheikh", preview: "Brochure received 👍", time: "Yesterday", unread: 0, active: false },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("");
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

export function InboxMock() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/5"
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-card-2 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="size-2.5 rounded-full bg-border" />
        <span className="ml-3 text-xs font-medium text-muted-foreground">
          Team Inbox
        </span>
      </div>

      <div className="grid sm:grid-cols-[230px_1fr] lg:grid-cols-[230px_1fr_190px]">
        {/* Conversation list */}
        <div className="hidden border-r border-border sm:block">
          <div className="flex gap-1 border-b border-border px-3 py-2 text-[11px] font-medium">
            <span className="rounded-md bg-primary-soft px-2 py-1 text-primary">All</span>
            <span className="px-2 py-1 text-muted-foreground">Unread</span>
            <span className="px-2 py-1 text-muted-foreground">Mine</span>
            <span className="px-2 py-1 text-muted-foreground">Unassigned</span>
          </div>
          <div className="mx-3 my-2 flex items-center gap-2 rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">
            <Search className="size-3" />
            Search conversations
          </div>
          {CONVERSATIONS.map((c) => (
            <div
              key={c.name}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5",
                c.active && "bg-primary-soft",
              )}
            >
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-foreground">
                    {c.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {c.time}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-muted-foreground">
                    {c.preview}
                  </span>
                  {c.unread > 0 && (
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
                      {c.unread}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Thread */}
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar name="Meera Nair" />
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-foreground">
                  Meera Nair
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Assigned to Priya
                </div>
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground">
              <Check className="size-3" />
              Resolve
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-2 bg-chat-bg px-4 py-4 text-xs">
            <div className="max-w-[80%] self-start rounded-lg rounded-tl-sm bg-bubble-in px-3 py-2 text-bubble-in-foreground shadow-xs">
              Hi, I saw your listing. Is the 2 BHK still available?
              <div className="mt-1 text-right text-[9px] opacity-60">10:41</div>
            </div>
            <div className="max-w-[80%] self-end rounded-lg rounded-tr-sm bg-bubble-out px-3 py-2 text-bubble-out-foreground shadow-xs">
              Yes it is. Would you like to book a visit this week?
              <div className="mt-1 flex items-center justify-end gap-1 text-[9px] opacity-70">
                10:42
                <CheckCheck className="size-3 text-info" />
              </div>
            </div>
            <div className="max-w-[80%] self-start rounded-lg rounded-tl-sm bg-bubble-in px-3 py-2 text-bubble-in-foreground shadow-xs">
              Saturday morning works for me.
              <div className="mt-1 text-right text-[9px] opacity-60">10:42</div>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
            <span className="flex-1 rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
              Type a message
            </span>
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Send className="size-3.5" />
            </span>
          </div>
        </div>

        {/* Contact panel */}
        <div className="hidden border-l border-border p-3 lg:block">
          <div className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            Tags
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
              Hot lead
            </span>
            <span className="rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info">
              2 BHK
            </span>
          </div>

          <div className="mt-4 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            Open deal
          </div>
          <div className="mt-1.5 rounded-md border border-border p-2">
            <div className="text-[11px] font-semibold text-foreground">
              Site visit
            </div>
            <div className="text-[10px] text-muted-foreground">
              Stage: Qualified
            </div>
          </div>

          <div className="mt-4 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            Internal notes
          </div>
          <div className="mt-1.5 flex gap-1.5 rounded-md bg-warning-soft p-2 text-[10px] text-warning">
            <StickyNote className="mt-0.5 size-3 shrink-0" />
            Prefers weekend visits.
          </div>
        </div>
      </div>
    </div>
  );
}

const PIPELINE = [
  { stage: "New", deals: ["Website enquiry", "Referral"] },
  { stage: "Qualified", deals: ["Site visit"] },
  { stage: "Won", deals: ["Annual plan"] },
];

export function PipelineMock() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-card-2 p-3"
    >
      {PIPELINE.map((column) => (
        <div key={column.stage}>
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-foreground">
            {column.stage}
            <span className="text-muted-foreground">{column.deals.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {column.deals.map((deal) => (
              <div
                key={deal}
                className="rounded-md border border-border bg-card p-2 text-[11px] font-medium text-foreground shadow-xs"
              >
                {deal}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const AUTOMATION_STEPS = [
  { kind: "Trigger", label: "Keyword match: “price”", trigger: true },
  { kind: "Action", label: "Send template" },
  { kind: "Action", label: "Add tag: Interested" },
  { kind: "Wait", label: "1 day" },
  { kind: "Action", label: "Assign conversation" },
];

export function AutomationMock() {
  return (
    <div
      aria-hidden="true"
      className="rounded-xl border border-border bg-card-2 p-4"
    >
      <ol className="flex flex-col">
        {AUTOMATION_STEPS.map((step, index) => (
          <li key={step.label} className="flex flex-col items-start">
            {index > 0 && <span className="ml-4 h-3 w-px bg-input" />}
            <div className="flex w-full items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 shadow-xs">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold",
                  step.trigger
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {step.trigger ? <Zap className="size-3" /> : index}
              </span>
              <span className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                {step.kind}
              </span>
              <span className="truncate text-xs font-medium text-foreground">
                {step.label}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const CAMPAIGN_STATS = [
  { label: "Sent", value: "100%", width: "100%" },
  { label: "Delivered", value: "96%", width: "96%" },
  { label: "Read", value: "71%", width: "71%" },
  { label: "Replied", value: "18%", width: "18%" },
];

export function CampaignMock() {
  return (
    <div
      aria-hidden="true"
      className="rounded-xl border border-border bg-card-2 p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground">
          Festive offer
        </span>
        <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
          Sample data
        </span>
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        {CAMPAIGN_STATS.map((stat) => (
          <div key={stat.label}>
            <div className="mb-1 flex justify-between text-[11px]">
              <span className="text-muted-foreground">{stat.label}</span>
              <span className="font-medium text-foreground">{stat.value}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted">
              <div
                className="h-1.5 rounded-full bg-primary"
                style={{ width: stat.width }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
