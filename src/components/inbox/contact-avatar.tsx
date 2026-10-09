import { cn } from "@/lib/utils";

// Soft tints for initial-avatars. Picked per contact from a stable hash
// of the name so the same person keeps the same colour everywhere.
const TINTS = [
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  "bg-orange-500/15 text-orange-700 dark:text-orange-300",
] as const;

function tintFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return TINTS[Math.abs(hash) % TINTS.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  // Phone-number-only contacts: a "#" reads better than "+".
  if (parts.length === 0 || /^[+\d]/.test(parts[0])) return "#";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

const SIZES = {
  sm: "size-8 text-xs",
  md: "size-9 text-[13px]",
  lg: "size-14 text-lg",
} as const;

interface ContactAvatarProps {
  name: string;
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}

export function ContactAvatar({
  name,
  avatarUrl,
  size = "md",
  className,
}: ContactAvatarProps) {
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        className={cn(
          "shrink-0 rounded-full object-cover",
          SIZES[size],
          className,
        )}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        SIZES[size],
        tintFor(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
