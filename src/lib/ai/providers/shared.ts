import { AiError, type AgentMessage, type ChatMessage, type ToolDefinition } from '../types'

// ============================================================
// Bits shared by the OpenAI + Anthropic adapters.
// ============================================================

export interface ProviderArgs {
  apiKey: string
  model: string
  systemPrompt: string
  messages: ChatMessage[]
  timeoutMs: number
}

/** Sibling of `ProviderArgs` for the tool-calling agent path. */
export interface AgentProviderArgs {
  apiKey: string
  model: string
  systemPrompt: string
  messages: AgentMessage[]
  tools: ToolDefinition[]
  timeoutMs: number
}

/**
 * Raw provider output before handoff-sentinel parsing (that step happens
 * once, centrally, in `generate.ts` — same split as the plain
 * `generateOpenAi`/`generateAnthropic` returning raw text today).
 */
export type RawAgentResult =
  | { kind: 'text'; text: string }
  | { kind: 'tool_calls'; calls: { id: string; name: string; arguments: Record<string, unknown> }[] }

/** Map a fetch rejection (timeout / DNS / offline) to a typed AiError. */
export function toNetworkError(err: unknown): AiError {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new AiError('The AI provider took too long to respond.', {
      code: 'timeout',
      status: 504,
    })
  }
  const msg = err instanceof Error ? err.message : String(err)
  return new AiError(`Could not reach the AI provider: ${msg}`, {
    code: 'network_error',
    status: 502,
  })
}

/** Build a typed AiError from a non-2xx provider response, pulling the
 *  provider's own error message out of the JSON body when present. */
export async function providerHttpError(
  provider: string,
  res: Response,
): Promise<AiError> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } | string }
    detail =
      typeof body?.error === 'string'
        ? body.error
        : (body?.error?.message ?? '')
  } catch {
    // Non-JSON error body — fall back to the status line.
  }

  const { status } = res
  const code =
    status === 401 || status === 403
      ? 'invalid_key'
      : status === 429
        ? 'rate_limited'
        : 'provider_error'
  const base =
    code === 'invalid_key'
      ? `${provider} rejected the API key`
      : code === 'rate_limited'
        ? `${provider} rate limit reached`
        : `${provider} API error (${status})`

  return new AiError(detail ? `${base}: ${detail}` : base, {
    code,
    // Surface an auth failure as 401 so the settings "Test key" button
    // can show "invalid key"; everything else is an upstream 502.
    status: code === 'invalid_key' ? 401 : 502,
  })
}

/**
 * Collapse consecutive same-role turns into one (joined with blank
 * lines). Anthropic requires strictly alternating roles; merging is
 * also harmless for OpenAI and keeps the transcript compact.
 */
export function mergeConsecutive(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}

/** True for the plain user/assistant text variant of `AgentMessage` —
 *  distinguishes it from the tool-call and tool-result variants, which
 *  must never be silently merged into a preceding text turn (that would
 *  corrupt the tool-call/tool-result pairing both providers require). */
function isAgentText(
  m: AgentMessage,
): m is { role: 'user' | 'assistant'; content: string } {
  return (m.role === 'user' || m.role === 'assistant') && 'content' in m
}

/**
 * Tool-call-aware sibling of `mergeConsecutive`. Only collapses adjacent
 * plain-text turns of the same role; a `tool_calls` or `tool_result`
 * turn is always left standing on its own.
 */
export function mergeConsecutiveAgent(messages: AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (last && isAgentText(last) && isAgentText(m) && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`
    } else {
      out.push(m)
    }
  }
  return out
}
