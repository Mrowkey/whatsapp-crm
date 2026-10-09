"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/**
 * Light/dark mode toggle — a single icon button that flips the app
 * between the two modes. Both icons are rendered and CSS picks one off
 * the `data-mode` attribute, so the server-rendered markup matches the
 * client's regardless of which mode the boot script restored.
 */
export function ModeToggle({ className }: { className?: string }) {
  const { toggleMode } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleMode}
      aria-label="Toggle light or dark mode"
      title="Toggle light or dark mode"
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        className,
      )}
    >
      <Sun className="size-4 dark:hidden" />
      <Moon className="hidden size-4 dark:block" />
    </button>
  );
}
