-- ============================================================
-- AD REFERRAL ATTRIBUTION
--
-- Click-to-WhatsApp ads (Meta/Instagram "Send Message" ads) attach a
-- `referral` object to the first inbound message from a lead who
-- clicked one — source_type, ad id, headline, ctwa_clid, etc.
-- Stored as-is (raw payload, same pattern as ai_tool_invocations.arguments
-- and messages.flow_response_json) on the CONTACT row, captured only at
-- creation time, so it reflects the lead's original acquisition source
-- and is never overwritten by later messages.
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_referral JSONB;
