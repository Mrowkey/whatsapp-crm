import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Check,
  GitBranch,
  KeyRound,
  Lock,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Sparkles,
  Users,
  UsersRound,
  Webhook,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

import {
  AutomationMock,
  CampaignMock,
  InboxMock,
  PipelineMock,
} from "@/components/landing/product-mocks";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The one public marketing page. Signed-in visitors never see it: the
// middleware sends them from `/` straight to /dashboard. Every claim
// below maps to a module that ships in this repo — keep it that way
// when adding copy.
export const metadata: Metadata = {
  title: "Relay — shared WhatsApp inbox and CRM",
  description:
    "Relay puts one WhatsApp Business number in front of your whole team: a shared inbox, contacts, sales pipelines, campaigns, automations and analytics.",
  // The root layout keeps the app itself out of search engines; the
  // landing page is the one route meant to be found.
  robots: { index: true, follow: true },
};

interface Feature {
  icon: LucideIcon;
  title: string;
  body: string;
  beta?: boolean;
}

const FEATURES: Feature[] = [
  {
    icon: MessagesSquare,
    title: "Team Inbox",
    body: "Every agent works the same WhatsApp number. Assign conversations, filter by All, Unread, Mine or Unassigned, and resolve with one click.",
  },
  {
    icon: Users,
    title: "Contacts",
    body: "Tags, custom fields and internal notes on every contact. Import from CSV, with duplicates caught on the way in.",
  },
  {
    icon: GitBranch,
    title: "Pipelines",
    body: "Drag deals across a Kanban board, linked to the contact they came from. See pipeline value and weighted value at a glance.",
  },
  {
    icon: Megaphone,
    title: "Campaigns",
    body: "Send Meta-approved templates to an audience picked by tag, custom field or CSV, with per-recipient variables.",
  },
  {
    icon: Zap,
    title: "Automations",
    body: "Trigger on a new message, a keyword, a new contact, a tag or a schedule. Then reply, tag, assign, wait, branch or call a webhook.",
  },
  {
    icon: Workflow,
    title: "Flows",
    body: "Build guided chats on a visual canvas with buttons, lists, questions and conditions, then hand off to a human.",
    beta: true,
  },
  {
    icon: BarChart3,
    title: "Analytics",
    body: "Message volume, first-response time, campaign results and team workload over the last 7, 30 or 90 days.",
  },
  {
    icon: Sparkles,
    title: "AI replies",
    body: "Bring your own OpenAI, Anthropic or Groq key. Draft replies in the inbox, or switch on auto-reply with a per-conversation cap.",
  },
];

interface Spotlight {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  mock: React.ReactNode;
}

const SPOTLIGHTS: Spotlight[] = [
  {
    id: "pipelines",
    eyebrow: "CRM",
    title: "From first message to closed deal",
    body: "A chat becomes a contact, and a contact becomes a deal. Relay keeps all three connected, so nobody has to copy numbers into a spreadsheet.",
    points: [
      "Kanban pipelines with your own stages",
      "Deals, tags and notes shown beside the conversation",
      "Custom fields for the details your team tracks",
    ],
    mock: <PipelineMock />,
  },
  {
    id: "campaigns",
    eyebrow: "Engage",
    title: "Campaigns you can measure",
    body: "Pick an approved template, choose who gets it, personalise each message and send. Then watch what happened to every one.",
    points: [
      "Audiences by tag, custom field or uploaded CSV",
      "Delivery, read and reply rates per campaign",
      "Template submission and sync with Meta from Settings",
    ],
    mock: <CampaignMock />,
  },
  {
    id: "automations",
    eyebrow: "Automate",
    title: "Let the routine work run itself",
    body: "Start from a ready-made automation such as a welcome message or out-of-office reply, or build your own step by step. Every run is logged.",
    points: [
      "Seven triggers, including keyword match and time-based",
      "Waits, conditions and branches",
      "Flow templates for a welcome menu, FAQ bot and lead capture",
    ],
    mock: <AutomationMock />,
  },
];

const STEPS = [
  {
    title: "Connect your number",
    body: "Add your WhatsApp Business API credentials in Settings. Relay shows the connection status in the top bar.",
  },
  {
    title: "Invite your team",
    body: "Send an invite link and choose a role for each person: owner, admin, agent or viewer.",
  },
  {
    title: "Start replying",
    body: "Messages arrive in the shared inbox in real time. Assign them, reply, and track every deal that follows.",
  },
];

const PLATFORM: Feature[] = [
  {
    icon: UsersRound,
    title: "Roles and invitations",
    body: "Four roles decide who can view, reply, manage settings or own the workspace. Ownership can be transferred.",
  },
  {
    icon: Lock,
    title: "Protected by default",
    body: "WhatsApp access tokens are encrypted at rest with AES-256-GCM, and row-level security scopes every table to your account.",
  },
  {
    icon: KeyRound,
    title: "REST API",
    body: "Scoped, revocable API keys for messages, contacts, conversations and campaigns under /api/v1.",
  },
  {
    icon: Webhook,
    title: "Signed webhooks",
    body: "Get notified when a message arrives, a delivery status changes or a conversation opens.",
  },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary">
        <MessageSquare className="size-4 text-primary-foreground" />
      </span>
      <span className="text-base font-semibold tracking-tight text-foreground">
        Relay
      </span>
    </Link>
  );
}

function FeatureCard({ icon: Icon, title, body, beta }: Feature) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft">
        <Icon className="size-4.5 text-primary" />
      </span>
      <h3 className="mt-4 flex items-center gap-2 text-sm font-semibold text-foreground">
        {title}
        {beta && (
          <span className="rounded-full bg-info-soft px-1.5 py-0.5 text-[10px] font-medium text-info">
            Beta
          </span>
        )}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

const primaryCta = cn(buttonVariants({ size: "lg" }), "h-11 px-5 text-sm");
const secondaryCta = cn(
  buttonVariants({ variant: "outline", size: "lg" }),
  "h-11 px-5 text-sm",
);

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-card">
      <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <a href="#how-it-works" className="hover:text-foreground">
              How it works
            </a>
            <a href="#platform" className="hover:text-foreground">
              Platform
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <ModeToggle />
            <Link
              href="/login"
              className={cn(buttonVariants({ variant: "ghost" }), "h-9 px-3")}
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className={cn(buttonVariants(), "hidden h-9 px-3.5 sm:inline-flex")}
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="border-b border-border bg-background">
          <div className="mx-auto max-w-6xl px-4 pt-16 pb-14 sm:px-6 sm:pt-24">
            <div className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-primary" />
                Built on the WhatsApp Business API
              </span>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-6xl">
                One WhatsApp number.{" "}
                <span className="text-primary">Your whole team.</span>
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-pretty text-muted-foreground sm:text-lg">
                Relay is a shared WhatsApp inbox and CRM. Answer customers
                together, keep every contact and deal in one place, and reach
                them with campaigns and automations.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link href="/signup" className={primaryCta}>
                  Get started
                  <ArrowRight className="size-4" />
                </Link>
                <Link href="/login" className={secondaryCta}>
                  Sign in
                </Link>
              </div>
            </div>

            <div className="mx-auto mt-14 max-w-5xl">
              <InboxMock />
            </div>
          </div>
        </section>

        {/* Feature grid */}
        <section id="features" className="scroll-mt-16">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-primary">Features</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                Everything your team does on WhatsApp, in one workspace
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                Talk to customers, manage them, reach out at scale, then
                measure how it went.
              </p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((feature) => (
                <FeatureCard key={feature.title} {...feature} />
              ))}
            </div>
          </div>
        </section>

        {/* Spotlights */}
        <section className="border-y border-border bg-background">
          <div className="mx-auto flex max-w-6xl flex-col gap-20 px-4 py-20 sm:px-6">
            {SPOTLIGHTS.map((spot, index) => (
              <div
                key={spot.id}
                className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
              >
                <div className={cn(index % 2 === 1 && "lg:order-2")}>
                  <p className="text-sm font-semibold text-primary">
                    {spot.eyebrow}
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                    {spot.title}
                  </h2>
                  <p className="mt-3 text-base leading-relaxed text-muted-foreground">
                    {spot.body}
                  </p>
                  <ul className="mt-5 flex flex-col gap-2.5">
                    {spot.points.map((point) => (
                      <li
                        key={point}
                        className="flex items-start gap-2.5 text-sm text-foreground"
                      >
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary-soft-2">
                          <Check className="size-3 text-primary" />
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-border bg-card p-4 sm:p-6">
                  {spot.mock}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="scroll-mt-16">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-primary">How it works</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                Up and running in three steps
              </h2>
            </div>
            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="rounded-xl border border-border bg-card p-5"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-foreground">
                    {step.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Platform */}
        <section
          id="platform"
          className="scroll-mt-16 border-y border-border bg-background"
        >
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-primary">Platform</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                Built for teams, open to your other tools
              </h2>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {PLATFORM.map((item) => (
                <FeatureCard key={item.title} {...item} />
              ))}
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section>
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="rounded-2xl bg-primary px-6 py-14 text-center sm:px-12">
              <h2 className="text-3xl font-semibold tracking-tight text-balance text-primary-foreground">
                Bring your team into one inbox
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-base text-primary-foreground/85">
                Create a workspace, connect your number and invite your
                teammates.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/signup"
                  className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-white px-5 text-sm font-medium text-[#0A7C55] transition-colors hover:bg-white/90"
                >
                  Get started
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex h-11 items-center rounded-lg border border-white/40 px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-white/10"
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo />
          <p className="text-xs sm:max-w-md sm:text-center">
            WhatsApp is a trademark of Meta Platforms, Inc. Relay is not
            affiliated with or endorsed by Meta.
          </p>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
