// Server-only: reads secret env vars.

import type { BillingProvider } from './provider';
import { createStripeProvider } from './stripe';

/**
 * The configured provider, or null when billing isn't set up. A null
 * here is what keeps limits switched off on deployments that haven't
 * configured payments (see `isBillingEnforced` in `./guard.ts`).
 */
export function getBillingProvider(): BillingProvider | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return null;
  return createStripeProvider({
    secretKey,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || null,
  });
}
