import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface StatItem {
  label: string;
  /** Pre-formatted value. Pass "No data" rather than a made-up zero. */
  value: ReactNode;
  /** Secondary line under the value: a comparison, count or caveat. */
  hint?: ReactNode;
  /** Tone for the hint line. */
  tone?: "default" | "positive" | "negative" | "warning";
}

const TONE: Record<NonNullable<StatItem["tone"]>, string> = {
  default: "text-muted-foreground",
  positive: "text-success",
  negative: "text-destructive",
  warning: "text-warning",
};

/**
 * A row of compact metrics in one bordered card, split by hairlines.
 * Denser than a grid of separate cards: the numbers read as one
 * summary instead of competing tiles.
 */
export function StatStrip({
  items,
  loading = false,
  className,
}: {
  items: StatItem[];
  loading?: boolean;
  className?: string;
}) {
  return (
    <dl
      aria-busy={loading}
      className={cn(
        "grid grid-cols-2 overflow-hidden rounded-lg border border-border bg-card",
        items.length >= 5
          ? "sm:grid-cols-3 lg:grid-cols-5"
          : "lg:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => (
        // Each cell draws its own right + bottom hairline as a shadow;
        // the card's overflow-hidden clips the ones on the outer edge,
        // so dividers stay correct at every column count.
        <div
          key={item.label}
          className="px-4 py-3 shadow-[1px_0_0_0_var(--border),0_1px_0_0_var(--border)]"
        >
          <dt className="truncate text-xs font-medium text-muted-foreground">
            {item.label}
          </dt>
          <dd className="mt-1">
            {loading ? (
              <span className="block h-7 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <span className="block text-xl leading-7 font-semibold text-foreground tabular-nums">
                {item.value}
              </span>
            )}
            {item.hint && !loading && (
              <span
                className={cn(
                  "mt-0.5 block truncate text-xs",
                  TONE[item.tone ?? "default"],
                )}
              >
                {item.hint}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Small pill group for mutually exclusive choices (ranges, views). */
export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string; count?: number }[];
  /** Accessible name for the group. */
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
              selected
                ? "bg-primary-soft text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {opt.label}
            {opt.count !== undefined && (
              <span className="tabular-nums opacity-70">{opt.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
