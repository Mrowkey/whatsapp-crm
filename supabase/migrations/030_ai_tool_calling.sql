-- ============================================================
-- AI TOOL-CALLING
--
-- Upgrades the AI auto-reply assistant from a single-shot "generate
-- text" call into a tool-calling agent that can tag contacts, update
-- contact fields, create deals, and escalate to a human with a real,
-- captured reason (replacing the previous silent `[[HANDOFF]]`
-- sentinel string).
-- ============================================================

-- Escalation reason surfaces in the inbox as a persistent banner on
-- the conversation, alongside the existing `ai_autoreply_disabled`
-- flag (029_ai_reply.sql) that already gates re-triggering.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_handoff_reason TEXT;

-- Widen notifications.type so an escalation can page a human the same
-- way a manual conversation assignment already does.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'ai_escalation'));

-- Audit trail for every tool the agent invokes (success or failure).
-- Trusting an agent that can autonomously write to contacts/deals
-- requires being able to see exactly what it did and why — this is
-- the equivalent of flow_run_events for the AI's own actions. Written
-- only by the service-role auto-reply path; no client INSERT policy.
CREATE TABLE IF NOT EXISTS ai_tool_invocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  arguments JSONB NOT NULL DEFAULT '{}'::jsonb,
  success BOOLEAN NOT NULL,
  result_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_tool_invocations_conv
  ON ai_tool_invocations(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tool_invocations_account
  ON ai_tool_invocations(account_id, created_at DESC);

ALTER TABLE ai_tool_invocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_tool_invocations_select ON ai_tool_invocations FOR SELECT
  USING (is_account_member(account_id));
-- No INSERT/UPDATE/DELETE policy for authenticated clients — every row
-- is written by the service-role webhook/auto-reply path only.
