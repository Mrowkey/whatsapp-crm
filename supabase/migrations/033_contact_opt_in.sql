-- ============================================================
-- Contact opt-in tracking.
--
-- Prompted by a real WhatsApp Business Account lock following a bulk
-- broadcast to a mostly-unverified imported lead list. Meta's own
-- anti-spam enforcement (rate limits, "healthy ecosystem engagement"
-- blocks, account locks) is driven by recipient trust signals — the
-- root cause is messaging people who never actually opted in, not a
-- bug fixable purely in code. This migration adds the minimum
-- structural gate: every contact carries an explicit opted_in flag,
-- and broadcasts refuse to include anyone not marked true.
--
-- Defaults:
--   - New column defaults to TRUE going forward for contacts created
--     the "organic" way (customer messages in first, or a human adds
--     one manually) — an inbound message is itself an implied consent
--     signal under WhatsApp's own policy.
--   - CSV imports default to FALSE unless the importer explicitly
--     confirms consent for that batch (enforced in the import UI, not
--     the DB — the DB just needs the column to exist).
--   - Existing rows are backfilled TRUE (pre-existing contacts already
--     survived without a lock, and re-litigating consent for every
--     historical row isn't something this migration can determine).
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS opted_in BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_contacts_account_opted_in
  ON contacts(account_id, opted_in);
