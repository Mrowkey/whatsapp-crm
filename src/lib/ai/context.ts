import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage, CrmContext } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
}

/**
 * Fetch the last N text messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`. Non-text messages (media,
 * templates, interactive) are excluded — they carry no text to model.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text')
    .eq('conversation_id', conversationId)
    .eq('content_type', 'text')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .filter((m) => m.content_text && m.content_text.trim())
    .map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: m.content_text!.trim(),
    }))
}

/**
 * Pull the CRM-side facts about a contact (name, tags, custom fields,
 * most recent open deal) so the agent's system prompt can reference
 * real data instead of relying purely on raw chat history. Best-effort:
 * any individual lookup failing just yields an empty/null value rather
 * than failing the whole auto-reply (the conversation text alone is
 * still enough to generate a reply).
 */
export async function buildCrmContext(
  db: SupabaseClient,
  args: { accountId: string; contactId: string },
): Promise<CrmContext> {
  const { accountId, contactId } = args

  const [contactRes, tagsRes, customValuesRes, dealRes] = await Promise.all([
    db.from('contacts').select('name').eq('id', contactId).maybeSingle(),
    db
      .from('contact_tags')
      .select('tags(name)')
      .eq('contact_id', contactId),
    db
      .from('contact_custom_values')
      .select('value, custom_fields(field_name)')
      .eq('contact_id', contactId),
    db
      .from('deals')
      .select('title, value, pipelines(name), pipeline_stages(name)')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const contactName = (contactRes.data as { name: string | null } | null)?.name ?? null

  const tags = (
    (tagsRes.data ?? []) as { tags: { name: string } | { name: string }[] | null }[]
  )
    .map((row) => (Array.isArray(row.tags) ? row.tags[0]?.name : row.tags?.name))
    .filter((name): name is string => !!name)

  const customFields: Record<string, string> = {}
  for (const row of (customValuesRes.data ?? []) as {
    value: string | null
    custom_fields: { field_name: string } | { field_name: string }[] | null
  }[]) {
    const field = Array.isArray(row.custom_fields) ? row.custom_fields[0] : row.custom_fields
    if (field?.field_name && row.value) {
      customFields[field.field_name] = row.value
    }
  }

  const dealRow = dealRes.data as {
    title: string
    value: number
    pipelines: { name: string } | { name: string }[] | null
    pipeline_stages: { name: string } | { name: string }[] | null
  } | null
  const activeDeal = dealRow
    ? {
        title: dealRow.title,
        value: dealRow.value,
        pipelineName:
          (Array.isArray(dealRow.pipelines) ? dealRow.pipelines[0]?.name : dealRow.pipelines?.name) ??
          'Unknown pipeline',
        stageName:
          (Array.isArray(dealRow.pipeline_stages)
            ? dealRow.pipeline_stages[0]?.name
            : dealRow.pipeline_stages?.name) ?? 'Unknown stage',
      }
    : null

  return { contactName, tags, customFields, activeDeal }
}
