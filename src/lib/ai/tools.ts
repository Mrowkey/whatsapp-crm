import type { SupabaseClient } from '@supabase/supabase-js'
import type { ToolDefinition } from './types'
import { applyTag, createDeal, updateContactField } from '@/lib/crm-actions'

// ============================================================
// Tool definitions + executor for the AI auto-reply agent
// (src/lib/ai/agent.ts). Every write action reuses the same
// tenant-scoped helpers automations already relies on
// (src/lib/crm-actions.ts) — no separate/duplicate write path.
//
// Tool parameter enums are built from LIVE account data on every call
// so the model can only ever reference a tag/pipeline/stage/custom
// field that actually exists for this account — it cannot invent one.
// ============================================================

const PIPELINE_STAGE_SEPARATOR = ' / '

interface AccountToolData {
  tags: { id: string; name: string }[]
  customFields: { id: string; field_name: string }[]
  pipelineStages: { pipelineId: string; pipelineName: string; stageId: string; stageName: string }[]
}

async function loadAccountToolData(db: SupabaseClient, accountId: string): Promise<AccountToolData> {
  const [tagsRes, fieldsRes, pipelinesRes] = await Promise.all([
    db.from('tags').select('id, name').eq('account_id', accountId),
    db.from('custom_fields').select('id, field_name').eq('account_id', accountId),
    db
      .from('pipelines')
      .select('id, name, pipeline_stages(id, name)')
      .eq('account_id', accountId),
  ])

  const tags = (tagsRes.data ?? []) as { id: string; name: string }[]
  const customFields = (fieldsRes.data ?? []) as { id: string; field_name: string }[]

  const pipelineStages: AccountToolData['pipelineStages'] = []
  for (const p of (pipelinesRes.data ?? []) as {
    id: string
    name: string
    pipeline_stages: { id: string; name: string }[] | null
  }[]) {
    for (const s of p.pipeline_stages ?? []) {
      pipelineStages.push({ pipelineId: p.id, pipelineName: p.name, stageId: s.id, stageName: s.name })
    }
  }

  return { tags, customFields, pipelineStages }
}

/**
 * Build the tool schemas offered to the model this turn. Returns an
 * empty array (no tools) if the account has none of the underlying
 * data yet (e.g. no tags and no pipelines) for a given tool — Meta's
 * providers reject an enum with zero options, so a tool with nothing
 * to reference is simply omitted rather than sent broken.
 */
export async function buildToolDefinitions(
  db: SupabaseClient,
  accountId: string,
): Promise<ToolDefinition[]> {
  const data = await loadAccountToolData(db, accountId)
  const tools: ToolDefinition[] = []

  if (data.tags.length > 0) {
    tools.push({
      name: 'tag_contact',
      description:
        "Add or remove a tag on this contact, e.g. to mark them as interested, qualified, or not a fit. Only use when the conversation gives a clear, specific reason.",
      parameters: {
        type: 'object',
        properties: {
          tag_name: { type: 'string', enum: data.tags.map((t) => t.name) },
          mode: { type: 'string', enum: ['add', 'remove'] },
        },
        required: ['tag_name', 'mode'],
      },
    })
  }

  tools.push({
    name: 'update_contact_field',
    description:
      'Save a detail the customer shared into their contact record (name, email, company, or a custom field). Only use when the customer has actually stated the value.',
    parameters: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          enum: ['name', 'email', 'company', ...data.customFields.map((f) => f.field_name)],
        },
        value: { type: 'string' },
      },
      required: ['field', 'value'],
    },
  })

  if (data.pipelineStages.length > 0) {
    tools.push({
      name: 'create_deal',
      description:
        'Create a new deal in the sales pipeline once the customer shows genuine buying intent (not just casual interest). Only call this once per conversation.',
      parameters: {
        type: 'object',
        properties: {
          pipeline_and_stage: {
            type: 'string',
            description: `The pipeline and starting stage, formatted exactly as shown in the enum (e.g. "Sales Pipeline${PIPELINE_STAGE_SEPARATOR}New Lead").`,
            enum: data.pipelineStages.map(
              (ps) => `${ps.pipelineName}${PIPELINE_STAGE_SEPARATOR}${ps.stageName}`,
            ),
          },
          title: { type: 'string', description: 'Short deal title, e.g. the customer name + what they want.' },
          value: { type: 'number', description: 'Estimated deal value, if known. Omit if unknown.' },
        },
        required: ['pipeline_and_stage', 'title'],
      },
    })
  }

  tools.push({
    name: 'escalate_to_human',
    description:
      'Hand this conversation off to a human teammate. Always call this instead of guessing when you cannot confidently and safely help.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Short, specific reason a human needs to take over.' },
        urgency: { type: 'string', enum: ['low', 'normal', 'high'] },
      },
      required: ['reason'],
    },
  })

  return tools
}

export interface ExecuteToolContext {
  accountId: string
  conversationId: string
  contactId: string
  userId: string
}

export interface ExecuteToolResult {
  success: boolean
  resultForModel: string
}

async function logInvocation(
  db: SupabaseClient,
  ctx: ExecuteToolContext,
  toolName: string,
  args: Record<string, unknown>,
  success: boolean,
  resultSummary: string,
): Promise<void> {
  await db.from('ai_tool_invocations').insert({
    account_id: ctx.accountId,
    conversation_id: ctx.conversationId,
    contact_id: ctx.contactId,
    tool_name: toolName,
    arguments: args,
    success,
    result_summary: resultSummary,
  })
}

/** Notify every member of the account — a small-team fan-out; revisit
 *  if the account ever grows past a handful of seats. */
async function notifyAccountOfEscalation(
  db: SupabaseClient,
  ctx: ExecuteToolContext,
  reason: string,
): Promise<void> {
  const { data: members } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', ctx.accountId)
  const rows = ((members ?? []) as { user_id: string }[]).map((m) => ({
    account_id: ctx.accountId,
    user_id: m.user_id,
    type: 'ai_escalation',
    conversation_id: ctx.conversationId,
    contact_id: ctx.contactId,
    title: 'AI escalated a conversation',
    body: reason,
  }))
  if (rows.length > 0) {
    await db.from('notifications').insert(rows)
  }
}

export async function executeTool(
  db: SupabaseClient,
  ctx: ExecuteToolContext,
  call: { name: string; arguments: Record<string, unknown> },
): Promise<ExecuteToolResult> {
  try {
    switch (call.name) {
      case 'tag_contact': {
        const tagName = String(call.arguments.tag_name ?? '')
        const mode = call.arguments.mode === 'remove' ? 'remove' : 'add'
        const { data: tag } = await db
          .from('tags')
          .select('id')
          .eq('account_id', ctx.accountId)
          .eq('name', tagName)
          .maybeSingle()
        if (!tag) {
          const msg = `Tag "${tagName}" does not exist.`
          await logInvocation(db, ctx, call.name, call.arguments, false, msg)
          return { success: false, resultForModel: msg }
        }
        await applyTag(db, { contactId: ctx.contactId, tagId: tag.id as string, mode })
        const msg = `Tag "${tagName}" ${mode === 'add' ? 'added' : 'removed'}.`
        await logInvocation(db, ctx, call.name, call.arguments, true, msg)
        return { success: true, resultForModel: msg }
      }

      case 'update_contact_field': {
        const fieldInput = String(call.arguments.field ?? '')
        const value = String(call.arguments.value ?? '')
        const builtIn = new Set(['name', 'email', 'company'])
        let field = fieldInput
        if (!builtIn.has(fieldInput)) {
          const { data: cf } = await db
            .from('custom_fields')
            .select('id')
            .eq('account_id', ctx.accountId)
            .eq('field_name', fieldInput)
            .maybeSingle()
          if (!cf) {
            const msg = `Field "${fieldInput}" does not exist.`
            await logInvocation(db, ctx, call.name, call.arguments, false, msg)
            return { success: false, resultForModel: msg }
          }
          field = `custom:${cf.id}`
        }
        const result = await updateContactField(db, {
          accountId: ctx.accountId,
          contactId: ctx.contactId,
          field,
          value,
        })
        const msg = result.ok ? `Saved ${fieldInput} = "${value}".` : (result.reason ?? 'Update failed.')
        await logInvocation(db, ctx, call.name, call.arguments, result.ok, msg)
        return { success: result.ok, resultForModel: msg }
      }

      case 'create_deal': {
        const combo = String(call.arguments.pipeline_and_stage ?? '')
        const [pipelineName, stageName] = combo.split(PIPELINE_STAGE_SEPARATOR)
        const { data: pipeline } = await db
          .from('pipelines')
          .select('id, pipeline_stages(id, name)')
          .eq('account_id', ctx.accountId)
          .eq('name', pipelineName)
          .maybeSingle()
        const stage = (
          (pipeline as { pipeline_stages: { id: string; name: string }[] } | null)?.pipeline_stages ?? []
        ).find((s) => s.name === stageName)
        if (!pipeline || !stage) {
          const msg = `Pipeline/stage "${combo}" does not exist.`
          await logInvocation(db, ctx, call.name, call.arguments, false, msg)
          return { success: false, resultForModel: msg }
        }
        const title = String(call.arguments.title ?? 'New deal')
        const value = typeof call.arguments.value === 'number' ? call.arguments.value : undefined
        const { dealId } = await createDeal(db, {
          accountId: ctx.accountId,
          userId: ctx.userId,
          contactId: ctx.contactId,
          pipelineId: (pipeline as { id: string }).id,
          stageId: stage.id,
          title,
          value,
        })
        const msg = `Deal "${title}" created in ${combo}.`
        await logInvocation(db, ctx, call.name, call.arguments, !!dealId, msg)
        return { success: !!dealId, resultForModel: msg }
      }

      case 'escalate_to_human': {
        const reason = String(call.arguments.reason ?? 'No reason given.')
        await db
          .from('conversations')
          .update({ ai_handoff_reason: reason })
          .eq('id', ctx.conversationId)
        await notifyAccountOfEscalation(db, ctx, reason)
        const msg = `Escalated to a human: ${reason}`
        await logInvocation(db, ctx, call.name, call.arguments, true, msg)
        return { success: true, resultForModel: msg }
      }

      default: {
        const msg = `Unknown tool "${call.name}".`
        await logInvocation(db, ctx, call.name, call.arguments, false, msg)
        return { success: false, resultForModel: msg }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tool execution failed.'
    await logInvocation(db, ctx, call.name, call.arguments, false, msg).catch(() => {})
    return { success: false, resultForModel: msg }
  }
}
