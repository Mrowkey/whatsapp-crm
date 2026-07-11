'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Circle, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { loadOnboardingStatus, type OnboardingStatus } from '@/lib/dashboard/onboarding'
import { cn } from '@/lib/utils'

const DISMISS_KEY = 'wacrm:dashboard:getting-started-dismissed'

interface Step {
  key: keyof OnboardingStatus
  title: string
  description: string
  href: string
  cta: string
}

const STEPS: Step[] = [
  {
    key: 'whatsappConnected',
    title: 'Connect your WhatsApp number',
    description: 'Link your business WhatsApp account so messages can flow in and out.',
    href: '/settings',
    cta: 'Go to Settings',
  },
  {
    key: 'hasContacts',
    title: 'Add your contacts',
    description: 'Import a spreadsheet of leads and clients, or add them one by one.',
    href: '/contacts',
    cta: 'Go to Contacts',
  },
  {
    key: 'hasApprovedTemplate',
    title: 'Get a message template approved',
    description: 'Templates let you message people outside the 24-hour reply window.',
    href: '/settings?tab=templates',
    cta: 'Go to Templates',
  },
  {
    key: 'hasBroadcast',
    title: 'Send your first broadcast',
    description: 'Reach every contact (or a filtered group) with one message, at once.',
    href: '/broadcasts/new',
    cta: 'Create Broadcast',
  },
  {
    key: 'hasTeammate',
    title: 'Invite your team',
    description: 'Bring in teammates so conversations can be shared and assigned.',
    href: '/settings?tab=members',
    cta: 'Invite Teammates',
  },
]

/**
 * First-run checklist for non-technical users: turns an empty, jargon-y
 * dashboard into a guided "what do I do next" list. Auto-hides once every
 * step is complete, and can be dismissed early (per-browser) if a team
 * wants it gone sooner.
 */
export function GettingStarted() {
  const { accountId } = useAuth()
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [dismissed, setDismissed] = useState(true) // default hidden until we know it's needed

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === 'true') return
    } catch {
      // ignore storage errors, fall through to showing the checklist
    }
    setDismissed(false)

    const supabase = createClient()
    loadOnboardingStatus(supabase, accountId)
      .then(setStatus)
      .catch((err) => console.error('[dashboard] onboarding status failed:', err))
  }, [accountId])

  if (dismissed || !status) return null

  const doneCount = STEPS.filter((s) => status[s.key]).length
  if (doneCount === STEPS.length) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(DISMISS_KEY, 'true')
    } catch {
      // best-effort persistence only
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Getting started</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {doneCount} of {STEPS.length} steps done — finish these to start messaging your leads.
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss getting started checklist"
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <ul className="mt-4 divide-y divide-border">
        {STEPS.map((step) => {
          const done = status[step.key]
          return (
            <li key={step.key} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              {done ? (
                <Check className="size-5 shrink-0 text-primary" />
              ) : (
                <Circle className="size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    'text-sm font-medium',
                    done ? 'text-muted-foreground line-through' : 'text-foreground',
                  )}
                >
                  {step.title}
                </p>
                {!done && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
                )}
              </div>
              {!done && (
                <Link
                  href={step.href}
                  className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  {step.cta}
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
