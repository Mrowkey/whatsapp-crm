import {
  AiError,
  type AgentGenerateResult,
  type AgentMessage,
  type AiConfig,
  type ChatMessage,
  type GenerateResult,
  type ToolDefinition,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi, generateOpenAiWithTools } from './providers/openai'
import { generateAnthropic, generateAnthropicWithTools } from './providers/anthropic'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let raw: string
  switch (config.provider) {
    case 'openai':
      raw = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      raw = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(raw)
}

/**
 * Split the raw model output into `{ text, handoff }`. The sentinel can
 * appear alone or trailing a partial reply; either way we treat the
 * turn as a handoff and strip the marker from any remaining text.
 */
export function parseGeneration(raw: string): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff }
}

export interface GenerateAgentArgs {
  config: AiConfig
  systemPrompt: string
  /** Full tool-calling transcript, oldest first. */
  messages: AgentMessage[]
  tools: ToolDefinition[]
}

/**
 * Tool-aware sibling of `generateReply`, used only by the auto-reply
 * agent loop (src/lib/ai/agent.ts). Dispatches to the *WithTools
 * provider adapters and applies the same handoff-sentinel parsing as
 * `parseGeneration` — but only to `kind: 'text'` outcomes; a
 * `kind: 'tool_calls'` outcome is returned as-is for the caller to
 * execute and feed back.
 */
export async function generateAgentReply(args: GenerateAgentArgs): Promise<AgentGenerateResult> {
  const { config, systemPrompt, messages, tools } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    tools,
    timeoutMs,
  }

  let raw
  switch (config.provider) {
    case 'openai':
      raw = await generateOpenAiWithTools(providerArgs)
      break
    case 'anthropic':
      raw = await generateAnthropicWithTools(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  if (raw.kind === 'tool_calls') {
    return raw
  }
  const { text, handoff } = parseGeneration(raw.text)
  return { kind: 'text', text, handoff }
}
