// ============================================================
// Stripe implementation of `BillingProvider`.
//
// Talks to Stripe's REST API with `fetch` (form-encoded bodies, the
// same way the rest of this codebase calls Meta) rather than the
// Stripe SDK — the surface used here is three endpoints and one HMAC.
//
// Webhook signatures follow Stripe's documented scheme: the
// `Stripe-Signature` header carries `t=<unix>,v1=<hex>`, where v1 is
// HMAC-SHA256(secret, `${t}.${rawBody}`). Events older than the
// tolerance are rejected to blunt replay.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { SubscriptionStatus } from './entitlements';
import {
  ProviderError,
  WebhookVerificationError,
  type BillingEvent,
  type BillingProvider,
  type CheckoutInput,
  type SubscriptionUpdate,
} from './provider';

const STRIPE_API = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_SECONDS = 300;

type Json = Record<string, unknown>;

function asObject(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Stripe fields are either an id or an expanded object with an `id`. */
function idOf(value: unknown): string | null {
  return asString(value) ?? asString(asObject(value)?.id);
}

function unixToDate(value: unknown): Date | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000)
    : null;
}

/**
 * Verify a `Stripe-Signature` header against the raw body. Exported
 * for tests. Throws `WebhookVerificationError` on any mismatch.
 */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (!header) {
    throw new WebhookVerificationError('Missing Stripe-Signature header');
  }

  let timestamp: string | null = null;
  const candidates: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') candidates.push(value);
  }

  if (!timestamp || !/^\d+$/.test(timestamp) || candidates.length === 0) {
    throw new WebhookVerificationError('Malformed Stripe-Signature header');
  }
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new WebhookVerificationError('Stripe signature timestamp out of tolerance');
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest();

  // Stripe may send several v1 signatures while a secret is being
  // rolled; any one matching is enough.
  const matched = candidates.some((candidate) => {
    if (!/^[0-9a-f]+$/i.test(candidate)) return false;
    const given = Buffer.from(candidate, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matched) {
    throw new WebhookVerificationError('Stripe signature mismatch');
  }
}

/** Stripe statuses the app stores; anything else is transitional. */
function mapStatus(value: unknown): SubscriptionStatus | null {
  switch (value) {
    case 'trialing':
    case 'active':
    case 'past_due':
    case 'canceled':
    case 'unpaid':
    case 'paused':
      return value;
    default:
      // 'incomplete' / 'incomplete_expired': a first payment that
      // hasn't succeeded. Not a state change for the account.
      return null;
  }
}

/**
 * Normalise a Stripe Subscription object. Exported for tests.
 *
 * `current_period_end` lives on the subscription in older API versions
 * and on each subscription item in newer ones — read both.
 */
export function subscriptionUpdateFromStripe(
  sub: Json,
  overrides: { accountId?: string | null; status?: SubscriptionStatus } = {},
): SubscriptionUpdate | null {
  const subscriptionId = asString(sub.id);
  if (!subscriptionId) return null;

  const items = asObject(sub.items)?.data;
  const firstItem = Array.isArray(items) ? asObject(items[0]) : null;
  const metadata = asObject(sub.metadata);

  return {
    kind: 'subscription',
    accountId: overrides.accountId ?? asString(metadata?.account_id),
    customerId: idOf(sub.customer),
    subscriptionId,
    priceId: idOf(firstItem?.price),
    status: overrides.status ?? mapStatus(sub.status),
    currentPeriodEnd:
      unixToDate(sub.current_period_end) ??
      unixToDate(firstItem?.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
  };
}

export function createStripeProvider(config: {
  secretKey: string;
  webhookSecret: string | null;
}): BillingProvider {
  async function stripeRequest(
    method: 'GET' | 'POST',
    path: string,
    params?: Record<string, string>,
  ): Promise<Json> {
    let res: Response;
    try {
      res = await fetch(`${STRIPE_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${config.secretKey}`,
          ...(params
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        body: params ? new URLSearchParams(params).toString() : undefined,
      });
    } catch (err) {
      console.error('[billing/stripe] network error:', err);
      throw new ProviderError('Could not reach the payment provider');
    }

    const body = asObject(await res.json().catch(() => null));
    if (!res.ok || !body) {
      const message = asString(asObject(body?.error)?.message);
      console.error(`[billing/stripe] ${method} ${path} → ${res.status}:`, message);
      throw new ProviderError(message ?? 'The payment provider rejected the request');
    }
    return body;
  }

  return {
    id: 'stripe',

    async createCheckoutSession(input: CheckoutInput) {
      const params: Record<string, string> = {
        mode: 'subscription',
        'line_items[0][price]': input.priceId,
        'line_items[0][quantity]': '1',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        // Both carry the account id: the session for
        // checkout.session.completed, the subscription for every later
        // customer.subscription.* event.
        client_reference_id: input.accountId,
        'metadata[account_id]': input.accountId,
        'subscription_data[metadata][account_id]': input.accountId,
        allow_promotion_codes: 'true',
      };
      if (input.customerId) params.customer = input.customerId;
      else if (input.customerEmail) params.customer_email = input.customerEmail;

      const session = await stripeRequest('POST', '/checkout/sessions', params);
      const url = asString(session.url);
      if (!url) throw new ProviderError('The payment provider returned no checkout URL');
      return { url };
    },

    async createPortalSession({ customerId, returnUrl }) {
      const session = await stripeRequest('POST', '/billing_portal/sessions', {
        customer: customerId,
        return_url: returnUrl,
      });
      const url = asString(session.url);
      if (!url) throw new ProviderError('The payment provider returned no portal URL');
      return { url };
    },

    async parseWebhook(rawBody: string, headers: Headers): Promise<BillingEvent> {
      if (!config.webhookSecret) {
        throw new WebhookVerificationError('STRIPE_WEBHOOK_SECRET is not set');
      }
      verifyStripeSignature(
        rawBody,
        headers.get('stripe-signature'),
        config.webhookSecret,
      );

      let event: Json | null;
      try {
        event = asObject(JSON.parse(rawBody));
      } catch {
        event = null;
      }
      const id = asString(event?.id);
      const type = asString(event?.type);
      const object = asObject(asObject(event?.data)?.object);
      if (!event || !id || !type || !object) {
        throw new WebhookVerificationError('Malformed Stripe event');
      }

      const base = {
        provider: 'stripe',
        id,
        type,
        createdAt: unixToDate(event.created) ?? new Date(),
      };

      switch (type) {
        case 'checkout.session.completed': {
          const subscriptionId = idOf(object.subscription);
          if (object.mode !== 'subscription' || !subscriptionId) {
            return { ...base, update: null };
          }
          // The session doesn't carry the subscription's price or
          // period — fetch the subscription itself.
          const sub = await stripeRequest(
            'GET',
            `/subscriptions/${encodeURIComponent(subscriptionId)}`,
          );
          return {
            ...base,
            update: subscriptionUpdateFromStripe(sub, {
              accountId:
                asString(object.client_reference_id) ??
                asString(asObject(object.metadata)?.account_id),
            }),
          };
        }
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          return { ...base, update: subscriptionUpdateFromStripe(object) };
        case 'customer.subscription.deleted':
          return {
            ...base,
            update: subscriptionUpdateFromStripe(object, { status: 'canceled' }),
          };
        case 'invoice.payment_failed': {
          // Newer API versions nest the subscription under `parent`.
          const parent = asObject(asObject(object.parent)?.subscription_details);
          return {
            ...base,
            update: {
              kind: 'payment_failed',
              customerId: idOf(object.customer),
              subscriptionId: idOf(object.subscription) ?? idOf(parent?.subscription),
            },
          };
        }
        default:
          return { ...base, update: null };
      }
    },
  };
}
