import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentMessage, AiConfig, ChatMessage } from './types'
import { generateAgentReply } from './generate'
import { buildToolDefinitions, executeTool } from './tools'

/** Bounded tool round-trips per inbound message — enough for a
 *  realistic "tag + create deal + reply" turn without letting a
 *  confused model loop indefinitely on the caller's own API key. */
const MAX_TOOL_ITERATIONS = 3

export interface RunAgenticReplyArgs {
  db: SupabaseClient
  config: AiConfig
  systemPrompt: string
  /** Recent conversation turns, oldest first (same shape buildConversationContext returns). */
  history: ChatMessage[]
  accountId: string
  conversationId: string
  contactId: string
  userId: string
}

/**
 * Tool-calling replacement for a direct `generateReply` call in the
 * auto-reply path. Calls the model, executes any tool calls it makes
 * (tag/update-field/create-deal/escalate — see tools.ts), feeds the
 * results back, and repeats until the model produces a final text
 * reply or escalates to a human. Returns the same `{ text, handoff }`
 * shape `dispatchInboundToAiReply` already knows how to handle, so the
 * claim-slot-and-send logic downstream is unchanged.
 */
export async function runAgenticReply(
  args: RunAgenticReplyArgs,
): Promise<{ text: string; handoff: boolean }> {
  const { db, config, systemPrompt, history, accountId, conversationId, contactId, userId } = args
  const ctx = { accountId, conversationId, contactId, userId }

  const tools = await buildToolDefinitions(db, accountId)
  const transcript: AgentMessage[] = history.map((m) => ({ role: m.role, content: m.content }))

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const result = await generateAgentReply({ config, systemPrompt, messages: transcript, tools })

    if (result.kind === 'text') {
      return { text: result.text, handoff: result.handoff }
    }

    transcript.push({ role: 'assistant', toolCalls: result.calls })

    let escalated = false
    for (const call of result.calls) {
      const execResult = await executeTool(db, ctx, call)
      transcript.push({
        role: 'tool_result',
        toolCallId: call.id,
        name: call.name,
        content: execResult.resultForModel,
      })
      if (call.name === 'escalate_to_human' && execResult.success) {
        escalated = true
      }
    }

    if (escalated) {
      // The tool already recorded the reason and notified the team.
      // Stop here — the human should see the customer's own message
      // in the thread, not a synthesized reply on top of it.
      return { text: '', handoff: true }
    }
    // No escalation this turn — loop back so the model can turn the
    // tool result(s) into an actual reply, or call more tools.
  }

  // Exhausted the loop without a text reply or an explicit escalation.
  // Force one so the customer is never silently left unanswered.
  await executeTool(db, ctx, {
    name: 'escalate_to_human',
    arguments: { reason: 'AI reached its tool-call limit without resolving the request.' },
  })
  return { text: '', handoff: true }
}
