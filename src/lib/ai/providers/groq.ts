import { AiError, type AgentMessage, type ToolDefinition } from '../types'
import {
  mergeConsecutive,
  mergeConsecutiveAgent,
  providerHttpError,
  toNetworkError,
  type AgentProviderArgs,
  type ProviderArgs,
  type RawAgentResult,
} from './shared'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

// Groq's Chat Completions endpoint is OpenAI-compatible, so the request/
// response shapes below mirror providers/openai.ts almost exactly — the
// one real difference is the token-limit field name (`max_tokens`, not
// OpenAI's newer `max_completion_tokens`, which Groq's compat layer
// doesn't recognize on most models).
const GROQ_MAX_OUTPUT_TOKENS = 1024

interface GroqResponse {
  choices?: {
    message?: {
      content?: string
      tool_calls?: { id: string; function: { name: string; arguments: string } }[]
    }
  }[]
}

export async function generateGroq(args: ProviderArgs): Promise<string> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        max_tokens: GROQ_MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Groq', res)
  }

  const data = (await res.json().catch(() => null)) as GroqResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('Groq returned an empty response.', {
      code: 'empty_response',
    })
  }
  return text
}

// ------------------------------------------------------------
// Tool-calling variant, used only by the auto-reply agent loop
// (src/lib/ai/agent.ts).
// ------------------------------------------------------------

interface GroqChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

function toGroqMessages(systemPrompt: string, messages: AgentMessage[]): GroqChatMessage[] {
  const out: GroqChatMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const m of mergeConsecutiveAgent(messages)) {
    if (m.role === 'tool_result') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    } else if ('toolCalls' in m) {
      out.push({
        role: 'assistant',
        content: null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      })
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}

function toGroqTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

function safeJsonParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export async function generateGroqWithTools(args: AgentProviderArgs): Promise<RawAgentResult> {
  const { apiKey, model, systemPrompt, messages, tools, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: toGroqMessages(systemPrompt, messages),
        ...(tools.length ? { tools: toGroqTools(tools) } : {}),
        max_tokens: GROQ_MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Groq', res)
  }

  const data = (await res.json().catch(() => null)) as GroqResponse | null
  const message = data?.choices?.[0]?.message

  if (message?.tool_calls?.length) {
    return {
      kind: 'tool_calls',
      calls: message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeJsonParse(tc.function.arguments),
      })),
    }
  }

  const text = message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('Groq returned an empty response.', {
      code: 'empty_response',
    })
  }
  return { kind: 'text', text }
}
