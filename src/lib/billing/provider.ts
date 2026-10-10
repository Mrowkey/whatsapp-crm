// ============================================================
// Payment provider seam.
//
// Everything the app needs from a payment provider, and nothing
// provider-shaped: routes and the webhook handler speak only these
// types. Stripe is the one implementation today (`./stripe.ts`);
// adding another (e.g. Razorpay) means one more file implementing
// `BillingProvider` plus a branch in `getBillingProvider()`
// (`./get-provider.ts`).
// ============================================================

import type { PlanId } from './plans';
import type { SubscriptionStatus } from './entitlements';

export interface CheckoutInput {
  accountId: string;
  plan: PlanId;
  priceId: string;
  /** Reuse the provider customer when the account already has one. */
  customerId: string | null;
  /** Prefills the checkout form for a first-time customer. */
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}

/**
 * A provider webhook reduced to what the app stores. `update` is null
 * for event types the app doesn't act on.
 */
export interface BillingEvent {
  provider: string;
  id: string;
  type: string;
  /** When the provider created the event — orders out-of-order deliveries. */
  createdAt: Date;
  update: SubscriptionUpdate | null;
}

export type SubscriptionUpdate =
  | {
      kind: 'subscription';
      /** Our account id, when the provider object carries it. */
      accountId: string | null;
      customerId: string | null;
      subscriptionId: string;
      priceId: string | null;
      /** Null = a transitional provider state the app doesn't store. */
      status: SubscriptionStatus | null;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
    }
  | {
      kind: 'payment_failed';
      customerId: string | null;
      subscriptionId: string | null;
    };

/** The webhook payload failed signature verification or was malformed. */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

/** The provider rejected a request or could not be reached. */
export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface BillingProvider {
  readonly id: string;
  /** Hosted checkout page for starting a subscription. */
  createCheckoutSession(input: CheckoutInput): Promise<{ url: string }>;
  /** Hosted page for changing plan, card, or canceling. */
  createPortalSession(input: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  /**
   * Verify the signature on a raw webhook body and normalise it.
   * Throws `WebhookVerificationError` when the body can't be trusted.
   */
  parseWebhook(rawBody: string, headers: Headers): Promise<BillingEvent>;
}
