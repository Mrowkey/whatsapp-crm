"use client"

import Link from 'next/link'
import { UserPlus, Briefcase, Megaphone, Zap } from 'lucide-react'
import type { ComponentType } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  label: string
  href: string
  icon: ComponentType<{ className?: string }>
  primary?: boolean
}

const ACTIONS: Action[] = [
  { label: 'New campaign', href: '/broadcasts/new', icon: Megaphone, primary: true },
  { label: 'Add contact', href: '/contacts', icon: UserPlus },
  { label: 'New deal', href: '/pipelines', icon: Briefcase },
  { label: 'New automation', href: '/automations/new', icon: Zap },
]

/** Compact shortcut buttons for the dashboard header. */
export function QuickActions() {
  return (
    <>
      {ACTIONS.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.href}
            href={a.href}
            className={cn(
              buttonVariants({ variant: a.primary ? 'default' : 'outline' }),
              // Secondary shortcuts collapse first on narrow screens.
              !a.primary && 'hidden sm:inline-flex',
            )}
          >
            <Icon />
            {a.label}
          </Link>
        )
      })}
    </>
  )
}
