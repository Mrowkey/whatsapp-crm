// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
}

// ============================================================
// Tool-calling — used only by the auto-reply agent (src/lib/ai/agent.ts),
// never by the manual "Draft with AI" path above. Kept as a distinct,
// additive surface so the simple text-only `generateReply`/`ChatMessage`
// contract above never has to change shape for consumers that don't
// need tools.
// ============================================================

/** One turn in a tool-calling transcript — a superset of `ChatMessage`
 *  that can also carry a model's tool-call request or a tool's result. */
export type AgentMessage =
  | { role: 'user' | 'assistant'; content: string }
  | {
      role: 'assistant'
      toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[]
    }
  | { role: 'tool_result'; toolCallId: string; name: string; content: string }

/** JSON-Schema-shaped function definition, translated per-provider by
 *  the adapters in `providers/{openai,anthropic}.ts`. */
export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required: string[]
  }
}

/** Outcome of a tool-aware generation call — either a final reply, or
 *  one or more tool calls the caller must execute and feed back. */
export type AgentGenerateResult =
  | { kind: 'text'; text: string; handoff: boolean }
  | { kind: 'tool_calls'; calls: { id: string; name: string; arguments: Record<string, unknown> }[] }

/** CRM facts about a contact, built by `buildCrmContext` (context.ts)
 *  and rendered into the agent's system prompt for personalization. */
export interface CrmContext {
  contactName: string | null
  tags: string[]
  customFields: Record<string, string>
  activeDeal: { pipelineName: string; stageName: string; title: string; value: number } | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
