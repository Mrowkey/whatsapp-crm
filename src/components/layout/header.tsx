"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useWhatsappStatus } from "@/hooks/use-whatsapp-status";
import {
  Bell,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  User,
} from "lucide-react";
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
import { ModeToggle } from "@/components/layout/mode-toggle";
import { cn } from "@/lib/utils";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/inbox": "Team Inbox",
  "/notifications": "Notifications",
  "/contacts": "Contacts",
  "/pipelines": "Pipelines",
  "/broadcasts": "Campaigns",
  "/automations": "Automations",
  "/flows": "Flows",
  "/analytics": "Analytics",
  "/settings": "Settings",
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "Dashboard";
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile — the
   *  hamburger button is hidden on lg+. */
  onOpenSidebar?: () => void;
}

const iconButtonClass =
  "relative flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none";

export function Header({ onOpenSidebar }: HeaderProps) {
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const unreadNotifications = useUnreadNotifications();
  const whatsappStatus = useWhatsappStatus();
  const title = getPageTitle(pathname);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-3 lg:px-5">
      <div className="flex min-w-0 items-center gap-1.5">
        {/* Hamburger — mobile only. */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label="Open menu"
          className="-ml-1 flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="size-5" />
        </button>
        {/* Not a heading: each page renders its own <h1>. This is the
            "where am I" label for the shell (and the only title on
            full-bleed pages like the inbox). */}
        <p className="truncate text-sm font-semibold text-foreground">
          {title}
        </p>
      </div>

      <div className="flex items-center gap-1">
        {/* WhatsApp connection status — reflects the account's real
            whatsapp_config row; hidden until that answer is known. */}
        {whatsappStatus && (
          <Link
            href="/settings?tab=whatsapp"
            title={
              whatsappStatus === "connected"
                ? "WhatsApp number is connected"
                : "WhatsApp is not connected. Open settings to connect."
            }
            className={cn(
              "mr-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              whatsappStatus === "connected"
                ? "border-transparent bg-success-soft text-success hover:brightness-95"
                : "border-transparent bg-warning-soft text-warning hover:brightness-95",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                whatsappStatus === "connected" ? "bg-success" : "bg-warning",
              )}
            />
            <span className="hidden sm:inline">
              {whatsappStatus === "connected"
                ? "WhatsApp connected"
                : "WhatsApp not connected"}
            </span>
            <span className="sm:hidden">
              {whatsappStatus === "connected" ? "Connected" : "Offline"}
            </span>
          </Link>
        )}

        <Link
          href="/notifications"
          aria-label={
            unreadNotifications > 0
              ? `Notifications, ${unreadNotifications} unread`
              : "Notifications"
          }
          title="Notifications"
          className={cn(
            iconButtonClass,
            pathname.startsWith("/notifications") && "bg-muted text-foreground",
          )}
        >
          <Bell className="size-4" />
          {unreadNotifications > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white tabular-nums">
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </Link>

        <ModeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            className="ml-1 flex items-center rounded-full transition-shadow hover:ring-2 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none data-popup-open:ring-2 data-popup-open:ring-border"
            aria-label="Open account menu"
          >
            <Avatar className="size-7">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? "Avatar"}
                />
              ) : null}
              <AvatarFallback className="bg-primary-soft text-xs font-semibold text-primary">
                {initial}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6} className="w-56">
            <div className="px-2 py-1.5">
              <p className="truncate text-sm font-medium text-foreground">
                {profile?.full_name ?? "User"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {profile?.email ?? ""}
              </p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href="/settings?tab=profile" />}>
              <User className="size-4" />
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem render={<Link href="/settings" />}>
              <SettingsIcon className="size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={signOut}>
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
