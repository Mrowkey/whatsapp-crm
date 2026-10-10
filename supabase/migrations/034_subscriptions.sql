-- ============================================================
-- 034_subscriptions.sql — Per-account subscriptions (billing)
--
-- Billing is per ACCOUNT (workspace), never per user. Three tables:
--
--   account_subscriptions — one row per account: which plan it is on,
--     the provider's customer/subscription ids, and the lifecycle
--     state (trialing / active / past_due / canceled …).
--   billing_events — provider webhook event ids already applied, so a
--     redelivered event is a no-op (idempotency).
--   billing_usage — monthly usage counters the app can't derive from
--     existing rows (campaign recipients actually sent).
--
-- What the plan ids mean and what each plan allows is NOT stored here —
-- it lives in src/lib/billing/plans.ts so limits can be edited without
-- a migration. `plan` is therefore free TEXT.
--
-- Every account gets a 14-day free trial: a trigger creates the row
-- for new accounts and the backfill below creates it for existing
-- ones (their 14 days start when this migration is applied). The
-- trial length here must match TRIAL_DAYS in src/lib/billing/plans.ts.
--
-- Writes happen only through the service role (webhook route, send
-- routes). Members may read their own account's subscription and
-- usage so the app can show plan status and upgrade prompts.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ============================================================
-- ACCOUNT_SUBSCRIPTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS account_subscriptions (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'trial',
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (
    status IN ('trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')
  ),
  -- Payment provider that owns the ids below ('stripe' today). NULL
  -- while the account is still on the free trial and has never paid.
  provider TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  provider_price_id TEXT,
  trial_ends_at TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  -- Creation time of the newest provider event applied to this row.
  -- Webhooks can arrive out of order; an event older than this is
  -- skipped so it can't roll the row back to a stale state.
  provider_event_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_subscriptions_customer
  ON account_subscriptions(provider_customer_id)
  WHERE provider_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_account_subscriptions_subscription
  ON account_subscriptions(provider_subscription_id)
  WHERE provider_subscription_id IS NOT NULL;

ALTER TABLE account_subscriptions ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON account_subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Any member reads (agents and viewers need to know why sending is
-- blocked). No INSERT/UPDATE/DELETE policy: only the service role
-- writes, so a member can't grant their own account a plan.
DROP POLICY IF EXISTS account_subscriptions_select ON account_subscriptions;
CREATE POLICY account_subscriptions_select ON account_subscriptions FOR SELECT
  USING (is_account_member(account_id));

-- ============================================================
-- BILLING_EVENTS — webhook idempotency ledger
--
-- Service-role only (RLS on, no policies).
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, event_id)
);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- BILLING_USAGE — monthly counters
--
-- `period_start` is the first day (UTC) of the calendar month the
-- count belongs to. Only metric today: 'broadcast_recipients'.
-- ============================================================
CREATE TABLE IF NOT EXISTS billing_usage (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  period_start DATE NOT NULL,
  count BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, metric, period_start)
);

ALTER TABLE billing_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_usage_select ON billing_usage;
CREATE POLICY billing_usage_select ON billing_usage FOR SELECT
  USING (is_account_member(account_id));

-- Atomic add-to-counter. Service-role only: a member must not be able
-- to reset or inflate their own usage.
CREATE OR REPLACE FUNCTION public.increment_billing_usage(
  p_account_id UUID,
  p_metric TEXT,
  p_period_start DATE,
  p_amount BIGINT
) RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO billing_usage (account_id, metric, period_start, count)
  VALUES (p_account_id, p_metric, p_period_start, GREATEST(p_amount, 0))
  ON CONFLICT (account_id, metric, period_start)
  DO UPDATE SET count = billing_usage.count + GREATEST(p_amount, 0),
                updated_at = NOW()
  RETURNING count;
$$;

ALTER FUNCTION public.increment_billing_usage(UUID, TEXT, DATE, BIGINT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.increment_billing_usage(UUID, TEXT, DATE, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_billing_usage(UUID, TEXT, DATE, BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_billing_usage(UUID, TEXT, DATE, BIGINT) TO service_role;

-- ============================================================
-- TRIAL FOR NEW ACCOUNTS
--
-- A trigger on `accounts` rather than an edit to `handle_new_user`,
-- so every path that creates an account gets a trial. A failure here
-- must never block signup, hence the swallowed exception: an account
-- with no subscription row is treated by the app as an open trial.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_trial_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.account_subscriptions (account_id, plan, status, trial_ends_at)
  VALUES (NEW.id, 'trial', 'trialing', NOW() + INTERVAL '14 days')
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create trial subscription for account %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.create_trial_subscription() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_account_created_start_trial ON accounts;
CREATE TRIGGER on_account_created_start_trial
  AFTER INSERT ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.create_trial_subscription();

-- ============================================================
-- BACKFILL — a trial for every existing account
--
-- The 14 days start now (when the migration is applied), not at the
-- account's original creation date, so long-standing accounts aren't
-- locked out the moment billing is switched on.
-- ============================================================
INSERT INTO account_subscriptions (account_id, plan, status, trial_ends_at)
SELECT a.id, 'trial', 'trialing', NOW() + INTERVAL '14 days'
FROM accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM account_subscriptions s WHERE s.account_id = a.id
);
