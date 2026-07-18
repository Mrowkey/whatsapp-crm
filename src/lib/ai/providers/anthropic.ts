import { AiError, type AgentMessage, type ChatMessage, type ToolDefinition } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  mergeConsecutiveAgent,
  providerHttpError,
  toNetworkError,
  type AgentProviderArgs,
  type ProviderArgs,
  type RawAgentResult,
} from './shared'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
}

interface AnthropicResponseWithTools {
  content?: {
    type?: string
    text?: string
    id?: string
    name?: string
    input?: Record<string, unknown>
  }[]
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. Merge consecutive turns, then drop any leading
 * assistant turns (an agent greeting before the customer said anything)
 * so the transcript always starts on the customer. Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text (handoff parsing happens in
 * `generateReply`).
 */
export async function generateAnthropic(args: ProviderArgs): Promise<string> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: normalizeForAnthropic(messages),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Anthropic', res)
  }

  const data = (await res.json().catch(() => null)) as AnthropicResponse | null
  const text = data?.content
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw new AiError('Anthropic returned an empty response.', {
      code: 'empty_response',
    })
  }
  return text
}

// ------------------------------------------------------------
// Tool-calling variant, used only by the auto-reply agent loop
// (src/lib/ai/agent.ts). Independent of `generateAnthropic` above so
// the manual "Draft with AI" path is never affected by this.
// ------------------------------------------------------------

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
}

interface AnthropicAgentMessage {
  role: 'user' | 'assistant'
  content: AnthropicContentBlock[]
}

/**
 * Anthropic has no dedicated "tool" role — a tool's result is a
 * `tool_result` content block inside a `user`-role message, and every
 * result belonging to the same prior tool-use turn MUST land in one
 * combined user message (a separate message per result is rejected).
 * This groups consecutive `tool_result` turns into a single message,
 * then applies the same "must start on user" rule as plain-text mode.
 */
function toAnthropicMessages(messages: AgentMessage[]): AnthropicAgentMessage[] {
  const merged = mergeConsecutiveAgent(messages)
  const out: AnthropicAgentMessage[] = []

  for (const m of merged) {
    if (m.role === 'tool_result') {
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: m.content,
      }
      const last = out[out.length - 1]
      const lastIsToolResultGroup =
        last && last.role === 'user' && last.content.every((b) => b.type === 'tool_result')
      if (lastIsToolResultGroup) {
        last.content.push(block)
      } else {
        out.push({ role: 'user', content: [block] })
      }
      continue
    }
    if ('toolCalls' in m) {
      out.push({
        role: 'assistant',
        content: m.toolCalls.map((tc) => ({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        })),
      })
      continue
    }
    out.push({ role: m.role, content: [{ type: 'text', text: m.content }] })
  }

  while (out.length > 0 && out[0].role === 'assistant') {
    out.shift()
  }
  if (out.length === 0) {
    return [
      {
        role: 'user',
        content: [{ type: 'text', text: '(The customer has not sent a message yet.)' }],
      },
    ]
  }
  return out
}

function toAnthropicTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
}

export async function generateAnthropicWithTools(args: AgentProviderArgs): Promise<RawAgentResult> {
  const { apiKey, model, systemPrompt, messages, tools, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: toAnthropicMessages(messages),
        ...(tools.length ? { tools: toAnthropicTools(tools) } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Anthropic', res)
  }

  const data = (await res.json().catch(() => null)) as AnthropicResponseWithTools | null
  const blocks = data?.content ?? []
  const toolUseBlocks = blocks.filter((b) => b.type === 'tool_use')

  if (toolUseBlocks.length > 0) {
    return {
      kind: 'tool_calls',
      calls: toolUseBlocks.map((b) => ({
        id: b.id ?? '',
        name: b.name ?? '',
        arguments: b.input ?? {},
      })),
    }
  }

  const text = blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw new AiError('Anthropic returned an empty response.', {
      code: 'empty_response',
    })
  }
  return { kind: 'text', text }
}
