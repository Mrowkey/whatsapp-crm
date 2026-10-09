"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import {
  BarChart3,
  Crown,
  GitBranch,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessageSquareText,
  MessagesSquare,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Per-role chip metadata for the account strip in the sidebar footer.
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: "Owner",
    className: "bg-warning-soft text-warning",
  },
  admin: {
    icon: Shield,
    label: "Admin",
    className: "bg-primary-soft text-primary",
  },
  agent: {
    icon: UserCog,
    label: "Agent",
    className: "bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    label: "Viewer",
    className: "bg-muted text-muted-foreground",
  },
};

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /**
   * When true, the nav row renders a small "Beta" chip after the label.
   * Purely informational — doesn't affect routing or access.
   */
  beta?: boolean;
}

interface NavGroup {
  /** Omitted for the first, unlabelled group. */
  label?: string;
  items: NavItem[];
}

// Grouped by job-to-be-done rather than one flat list: talk to
// customers, manage them, reach out at scale, then measure.
export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/inbox", label: "Team Inbox", icon: MessagesSquare },
    ],
  },
  {
    label: "CRM",
    items: [
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/pipelines", label: "Pipelines", icon: GitBranch },
    ],
  },
  {
    label: "Engage",
    items: [
      { href: "/broadcasts", label: "Campaigns", icon: Megaphone },
      { href: "/automations", label: "Automations", icon: Zap },
      { href: "/flows", label: "Flows", icon: Workflow, beta: true },
    ],
  },
  {
    label: "Insights",
    items: [{ href: "/analytics", label: "Analytics", icon: BarChart3 }],
  },
];

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

function navRowClass(isActive: boolean) {
  return cn(
    // Taller on touch so fingers hit the row reliably (≥44px); compact on lg+.
    "group relative flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-[13px] font-medium transition-colors lg:py-1.5",
    "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
    isActive
      ? "bg-primary-soft text-primary"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  // Only surface the account-name strip when it actually carries
  // information. A solo user's personal account is named after them
  // (the 017 signup trigger seeds it from `full_name`), so showing it
  // here would just duplicate the user name in the footer below. Wait
  // for the profile fetch to settle first to avoid a layout jump.
  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  // Close the drawer when route changes — users opened it to navigate,
  // so once they pick a destination the drawer should get out of the way.
  useEffect(() => {
    onClose?.();
    // Only pathname drives this — onClose identity doesn't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Lock body scroll and allow Escape to close while the drawer is open on
  // mobile. No-ops on desktop because the sidebar isn't positioned there.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const settingsActive = pathname.startsWith("/settings");

  return (
    <>
      {/* Backdrop — only exists on mobile and only when open. */}
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-foreground/30 transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible — reset all the mobile framing.
          "lg:static lg:z-0 lg:w-56 lg:translate-x-0 lg:transition-none",
        )}
        aria-label="Primary"
      >
        {/* Brand row. The close button only exists on mobile. */}
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 rounded-md px-1 py-1 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <MessageSquareText className="size-4" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-foreground">
              Relay
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group, i) => (
            <div key={group.label ?? i} className={cn(i > 0 && "mt-4")}>
              {group.label && (
                <p className="mb-1 px-2.5 text-[11px] font-semibold tracking-wider text-muted-foreground/80 uppercase">
                  {group.label}
                </p>
              )}
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);
                  const showUnread = item.href === "/inbox" && totalUnread > 0;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={isActive ? "page" : undefined}
                        className={navRowClass(isActive)}
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.beta && (
                          <span
                            aria-label="Beta feature"
                            className="rounded bg-warning-soft px-1 py-px text-[10px] font-semibold tracking-wide text-warning uppercase"
                          >
                            Beta
                          </span>
                        )}
                        {showUnread && (
                          <span
                            aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? "" : "s"}`}
                            className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums"
                          >
                            {totalUnread > 99 ? "99+" : totalUnread}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-sidebar-border p-2">
          <Link
            href="/settings"
            aria-current={settingsActive ? "page" : undefined}
            className={navRowClass(settingsActive)}
          >
            <Settings className="size-4 shrink-0" />
            Settings
          </Link>

          {/* Account name — surfaced only when it differs from the
              user's own name (see `showAccountStrip`). */}
          {showAccountStrip && account?.name ? (
            <div className="mt-2 flex items-center gap-2 px-2.5 text-xs text-muted-foreground">
              <span className="truncate" title={account.name}>
                {account.name}
              </span>
              {accountRole
                ? (() => {
                    const meta = ROLE_CHIP[accountRole];
                    const Icon = meta.icon;
                    return (
                      <span
                        className={cn(
                          "ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                          meta.className,
                        )}
                      >
                        <Icon className="size-3" />
                        {meta.label}
                      </span>
                    );
                  })()
                : null}
            </div>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-popup-open:bg-muted">
              <Avatar className="size-7 shrink-0">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary">
                  {profile?.full_name?.charAt(0)?.toUpperCase() ??
                    profile?.email?.charAt(0)?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] leading-tight font-medium text-foreground">
                  {profile?.full_name ?? "User"}
                </p>
                <p className="truncate text-[11px] leading-tight text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              sideOffset={6}
              className="min-w-52"
            >
              <DropdownMenuItem
                render={<Link href="/settings?tab=profile" onClick={onClose} />}
              >
                <User className="size-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                render={<Link href="/settings?tab=whatsapp" onClick={onClose} />}
              >
                <Settings className="size-4" />
                WhatsApp settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}
