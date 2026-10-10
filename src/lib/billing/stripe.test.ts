import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebhookVerificationError } from './provider';
import {
  createStripeProvider,
  subscriptionUpdateFromStripe,
  verifyStripeSignature,
} from './stripe';

// Test-only values — not real Stripe credentials.
const SECRET = 'whsec_test_secret';
const NOW = 1_800_000_000;

function sign(body: string, timestamp = NOW, secret = SECRET): string {
  const v1 = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    current_period_end: 1_802_592_000,
    metadata: { account_id: 'acct-1' },
    items: { data: [{ price: { id: 'price_starter' } }] },
    ...overrides,
  };
}

function event(type: string, object: unknown, id = 'evt_1') {
  return JSON.stringify({
    id,
    type,
    created: NOW,
    data: { object },
  });
}

describe('verifyStripeSignature', () => {
  const body = '{"id":"evt_1"}';

  it('accepts a correctly signed body', () => {
    expect(() =>
      verifyStripeSignature(body, sign(body), SECRET, NOW),
    ).not.toThrow();
  });

  it('rejects a missing header', () => {
    expect(() => verifyStripeSignature(body, null, SECRET, NOW)).toThrow(
      WebhookVerificationError,
    );
  });

  it('rejects a body that was altered after signing', () => {
    expect(() =>
      verifyStripeSignature('{"id":"evt_2"}', sign(body), SECRET, NOW),
    ).toThrow(/mismatch/);
  });

  it('rejects a signature made with a different secret', () => {
    expect(() =>
      verifyStripeSignature(body, sign(body, NOW, 'whsec_other'), SECRET, NOW),
    ).toThrow(/mismatch/);
  });

  it('rejects a replayed event outside the tolerance window', () => {
    expect(() =>
      verifyStripeSignature(body, sign(body, NOW - 301), SECRET, NOW),
    ).toThrow(/tolerance/);
  });

  it('rejects a header with no v1 signature', () => {
    expect(() =>
      verifyStripeSignature(body, `t=${NOW},v0=abc`, SECRET, NOW),
    ).toThrow(/Malformed/);
  });

  it('accepts when any one of several v1 signatures matches (secret roll)', () => {
    const good = sign(body).split(',v1=')[1];
    const header = `t=${NOW},v1=${'0'.repeat(64)},v1=${good}`;
    expect(() => verifyStripeSignature(body, header, SECRET, NOW)).not.toThrow();
  });
});

describe('subscriptionUpdateFromStripe', () => {
  it('normalises a subscription object', () => {
    expect(subscriptionUpdateFromStripe(subscription())).toEqual({
      kind: 'subscription',
      accountId: 'acct-1',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      priceId: 'price_starter',
      status: 'active',
      currentPeriodEnd: new Date(1_802_592_000 * 1000),
      cancelAtPeriodEnd: false,
    });
  });

  it('reads the period end from the item on newer API versions', () => {
    const update = subscriptionUpdateFromStripe(
      subscription({
        current_period_end: undefined,
        items: {
          data: [
            { price: { id: 'price_growth' }, current_period_end: 1_805_000_000 },
          ],
        },
      }),
    );
    expect(update).toMatchObject({
      priceId: 'price_growth',
      currentPeriodEnd: new Date(1_805_000_000 * 1000),
    });
  });

  it('maps an incomplete first payment to no status', () => {
    expect(
      subscriptionUpdateFromStripe(subscription({ status: 'incomplete' })),
    ).toMatchObject({ status: null });
  });

  it('accepts an expanded customer object', () => {
    expect(
      subscriptionUpdateFromStripe(subscription({ customer: { id: 'cus_9' } })),
    ).toMatchObject({ customerId: 'cus_9' });
  });
});

describe('stripe provider parseWebhook', () => {
  const provider = createStripeProvider({
    secretKey: 'sk_test_placeholder',
    webhookSecret: SECRET,
  });

  function headersFor(body: string): Headers {
    // Signed "now" so the real clock inside parseWebhook accepts it.
    const ts = Math.floor(Date.now() / 1000);
    return new Headers({ 'stripe-signature': sign(body, ts) });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('refuses an unsigned body', async () => {
    const body = event('customer.subscription.updated', subscription());
    await expect(provider.parseWebhook(body, new Headers())).rejects.toThrow(
      WebhookVerificationError,
    );
  });

  it('refuses when no webhook secret is configured', async () => {
    const open = createStripeProvider({
      secretKey: 'sk_test_placeholder',
      webhookSecret: null,
    });
    const body = event('customer.subscription.updated', subscription());
    await expect(open.parseWebhook(body, headersFor(body))).rejects.toThrow(
      WebhookVerificationError,
    );
  });

  it('normalises customer.subscription.updated', async () => {
    const body = event('customer.subscription.updated', subscription());
    const parsed = await provider.parseWebhook(body, headersFor(body));
    expect(parsed).toMatchObject({
      provider: 'stripe',
      id: 'evt_1',
      type: 'customer.subscription.updated',
      createdAt: new Date(NOW * 1000),
      update: { kind: 'subscription', status: 'active', accountId: 'acct-1' },
    });
  });

  it('forces canceled on customer.subscription.deleted', async () => {
    const body = event(
      'customer.subscription.deleted',
      subscription({ status: 'active' }),
    );
    const parsed = await provider.parseWebhook(body, headersFor(body));
    expect(parsed.update).toMatchObject({ status: 'canceled' });
  });

  it('fetches the subscription for checkout.session.completed', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(subscription({ metadata: {} })), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const body = event('checkout.session.completed', {
      id: 'cs_1',
      mode: 'subscription',
      subscription: 'sub_1',
      customer: 'cus_1',
      client_reference_id: 'acct-7',
    });
    const parsed = await provider.parseWebhook(body, headersFor(body));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_1');
    expect(init.method).toBe('GET');
    // The account comes from the session, not the (empty) sub metadata.
    expect(parsed.update).toMatchObject({
      kind: 'subscription',
      accountId: 'acct-7',
      subscriptionId: 'sub_1',
      priceId: 'price_starter',
    });
  });

  it('ignores a one-off (non-subscription) checkout', async () => {
    const body = event('checkout.session.completed', {
      id: 'cs_1',
      mode: 'payment',
    });
    const parsed = await provider.parseWebhook(body, headersFor(body));
    expect(parsed.update).toBeNull();
  });

  it('normalises invoice.payment_failed in both API shapes', async () => {
    const legacy = event('invoice.payment_failed', {
      customer: 'cus_1',
      subscription: 'sub_1',
    });
    expect((await provider.parseWebhook(legacy, headersFor(legacy))).update).toEqual({
      kind: 'payment_failed',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
    });

    const current = event('invoice.payment_failed', {
      customer: 'cus_1',
      parent: { subscription_details: { subscription: 'sub_2' } },
    });
    expect(
      (await provider.parseWebhook(current, headersFor(current))).update,
    ).toMatchObject({ subscriptionId: 'sub_2' });
  });

  it('passes through unhandled event types with no update', async () => {
    const body = event('customer.created', { id: 'cus_1' });
    const parsed = await provider.parseWebhook(body, headersFor(body));
    expect(parsed.update).toBeNull();
  });
});

describe('stripe provider checkout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a subscription-mode session tagged with the account', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://checkout.stripe.test/s' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createStripeProvider({
      secretKey: 'sk_test_placeholder',
      webhookSecret: SECRET,
    });
    const result = await provider.createCheckoutSession({
      accountId: 'acct-1',
      plan: 'starter',
      priceId: 'price_starter',
      customerId: null,
      customerEmail: 'owner@example.com',
      successUrl: 'https://app.example.com/settings?tab=billing&checkout=success',
      cancelUrl: 'https://app.example.com/settings?tab=billing&checkout=canceled',
    });

    expect(result.url).toBe('https://checkout.stripe.test/s');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('mode')).toBe('subscription');
    expect(sent.get('line_items[0][price]')).toBe('price_starter');
    expect(sent.get('client_reference_id')).toBe('acct-1');
    expect(sent.get('subscription_data[metadata][account_id]')).toBe('acct-1');
    expect(sent.get('customer_email')).toBe('owner@example.com');
    expect(sent.has('customer')).toBe(false);
  });

  it('reuses an existing customer instead of sending an email', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ url: 'https://checkout.stripe.test/s' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createStripeProvider({
      secretKey: 'sk_test_placeholder',
      webhookSecret: SECRET,
    });
    await provider.createCheckoutSession({
      accountId: 'acct-1',
      plan: 'growth',
      priceId: 'price_growth',
      customerId: 'cus_1',
      customerEmail: 'owner@example.com',
      successUrl: 'https://app.example.com/ok',
      cancelUrl: 'https://app.example.com/no',
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('customer')).toBe('cus_1');
    expect(sent.has('customer_email')).toBe(false);
  });

  it('surfaces a provider rejection as a ProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { message: 'No such price' } }), {
          status: 400,
        }),
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const provider = createStripeProvider({
      secretKey: 'sk_test_placeholder',
      webhookSecret: SECRET,
    });
    await expect(
      provider.createPortalSession({
        customerId: 'cus_1',
        returnUrl: 'https://app.example.com/settings',
      }),
    ).rejects.toThrow('No such price');
  });
});
