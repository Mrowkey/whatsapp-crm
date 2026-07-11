import type { SupabaseClient } from '@supabase/supabase-js'

export interface OnboardingStatus {
  whatsappConnected: boolean
  hasContacts: boolean
  hasApprovedTemplate: boolean
  hasBroadcast: boolean
  hasTeammate: boolean
}

/**
 * Cheap existence checks (head+count, no rows fetched) for the dashboard's
 * "Getting started" checklist. Every table here already scopes to the
 * caller's account via RLS, so no explicit account_id filter is needed
 * except on `profiles`, whose RLS intentionally allows reading every row
 * in the account (not just the caller's own).
 */
export async function loadOnboardingStatus(
  supabase: SupabaseClient,
  accountId: string | null,
): Promise<OnboardingStatus> {
  const [config, contacts, templates, broadcasts, profiles] = await Promise.all([
    supabase.from('whatsapp_config').select('status').maybeSingle(),
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase
      .from('message_templates')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'APPROVED'),
    supabase.from('broadcasts').select('id', { count: 'exact', head: true }),
    accountId
      ? supabase
          .from('profiles')
          .select('user_id', { count: 'exact', head: true })
          .eq('account_id', accountId)
      : Promise.resolve({ count: 1 }),
  ])

  return {
    whatsappConnected: config.data?.status === 'connected',
    hasContacts: (contacts.count ?? 0) > 0,
    hasApprovedTemplate: (templates.count ?? 0) > 0,
    hasBroadcast: (broadcasts.count ?? 0) > 0,
    hasTeammate: (profiles.count ?? 0) > 1,
  }
}
