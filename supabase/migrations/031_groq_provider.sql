-- ============================================================
-- GROQ PROVIDER
--
-- Widens ai_configs.provider to allow 'groq' alongside the existing
-- 'openai' / 'anthropic' options (see src/lib/ai/providers/groq.ts).
-- The original CHECK constraint from 029_ai_reply.sql only allowed the
-- first two, so saving a Groq config was rejected at the DB layer.
-- ============================================================

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'groq'));
