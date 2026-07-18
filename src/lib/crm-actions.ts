import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Tenant-scoped CRM write actions shared by the Automations engine
 * (src/lib/automations/engine.ts) and the AI agent's tool-calling layer
 * (src/lib/ai/tools.ts). Extracted from automations/engine.ts's
 * `runStep` so both callers use exactly one implementation of the
 * account-scoping guards — a mismatch here would be a real security
 * bug (cross-tenant contact/deal writes), not just duplicated code.
 */

export interface ApplyTagArgs {
  contactId: string
  tagId: string
  mode: 'add' | 'remove'
}

/**
 * contact_tags has no account_id column — tenant scoping relies entirely
 * on the caller having already verified contactId belongs to the caller's
 * account (both existing call sites — automations' dispatch guard and the
 * AI tool executor — do this before invoking).
 */
export async function applyTag(db: SupabaseClient, args: ApplyTagArgs): Promise<void> {
  if (args.mode === 'add') {
    await db
      .from('contact_tags')
      .upsert(
        { contact_id: args.contactId, tag_id: args.tagId },
        { onConflict: 'contact_id,tag_id', ignoreDuplicates: true },
      )
  } else {
    await db
      .from('contact_tags')
      .delete()
      .eq('contact_id', args.contactId)
      .eq('tag_id', args.tagId)
  }
}

export interface UpdateContactFieldArgs {
  accountId: string
  contactId: string
  /** 'name' | 'email' | 'company', or `custom:<custom_field_id>`. */
  field: string
  value: string
}

export interface UpdateContactFieldResult {
  ok: boolean
  reason?: string
}

export async function updateContactField(
  db: SupabaseClient,
  args: UpdateContactFieldArgs,
): Promise<UpdateContactFieldResult> {
  // Custom fields are encoded as `custom:<custom_field_id>`; anything else
  // is a built-in contact column.
  if (args.field.startsWith('custom:')) {
    const customFieldId = args.field.slice('custom:'.length)
    if (!customFieldId) {
      return { ok: false, reason: `field ${args.field} not writable` }
    }
    // Defense in depth: the service-role client bypasses RLS, so confirm
    // the field definition belongs to this account before writing.
    const { data: field } = await db
      .from('custom_fields')
      .select('id')
      .eq('id', customFieldId)
      .eq('account_id', args.accountId)
      .maybeSingle()
    if (!field) {
      return { ok: false, reason: `field ${args.field} not writable` }
    }
    // Upsert on the table's UNIQUE(contact_id, custom_field_id) so repeated
    // calls overwrite rather than duplicate.
    await db
      .from('contact_custom_values')
      .upsert(
        { contact_id: args.contactId, custom_field_id: customFieldId, value: args.value },
        { onConflict: 'contact_id,custom_field_id' },
      )
    return { ok: true }
  }

  const allowed = new Set(['name', 'email', 'company'])
  if (!allowed.has(args.field)) {
    return { ok: false, reason: `field ${args.field} not writable` }
  }
  // Defense in depth: scope the service-role write to the account so a
  // caller can't write across tenants even if an upstream guard is skipped.
  await db
    .from('contacts')
    .update({ [args.field]: args.value, updated_at: new Date().toISOString() })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
  return { ok: true }
}

export interface CreateDealArgs {
  accountId: string
  userId: string
  contactId: string | null
  pipelineId: string
  stageId: string
  title: string
  value?: number
}

export interface CreateDealResult {
  dealId: string | null
}

export async function createDeal(db: SupabaseClient, args: CreateDealArgs): Promise<CreateDealResult> {
  // Match the account's configured default currency rather than the
  // static `deals.currency` DB default — keeps deals created here
  // consistent with the one-currency-per-account rule. Falls back to
  // USD if the row is somehow missing the value (pre-021 forks).
  const { data: acct } = await db
    .from('accounts')
    .select('default_currency')
    .eq('id', args.accountId)
    .maybeSingle()

  const { data, error } = await db
    .from('deals')
    .insert({
      account_id: args.accountId,
      user_id: args.userId,
      pipeline_id: args.pipelineId,
      stage_id: args.stageId,
      contact_id: args.contactId,
      title: args.title,
      value: args.value ?? 0,
      currency: acct?.default_currency ?? 'USD',
      status: 'open',
    })
    .select('id')
    .single()

  if (error) throw error
  return { dealId: (data?.id as string | undefined) ?? null }
}
