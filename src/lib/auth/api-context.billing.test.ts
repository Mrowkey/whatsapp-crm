import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateApiKey } from "@/lib/api-keys/keys";
import type { ApiKeyRow } from "@/lib/api-keys/store";
import { BillingError, resolveAccess } from "@/lib/billing/entitlements";
import type { SubscriptionRow } from "@/lib/billing/entitlements";
import { __resetRateLimitForTests } from "@/lib/rate-limit";

// The plan gate inside requireApiKey: which requests a key may make
// depends on the account's plan and whether the workspace is writable.

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({ __isMockAdminClient: true }),
}));

const findActiveKeyByHash = vi.fn<(hash: string) => Promise<ApiKeyRow | null>>();
vi.mock("@/lib/api-keys/store", () => ({
  findActiveKeyByHash: (hash: string) => findActiveKeyByHash(hash),
  touchLastUsed: () => {},
}));

// Drive the real entitlement rules from a canned subscription row.
let subscription: Partial<SubscriptionRow> = {};
vi.mock("@/lib/billing/guard", async () => {
  const { assertFeature, assertWritable } = await import(
    "@/lib/billing/entitlements"
  );
  const access = () =>
    resolveAccess(
      { account_id: "acct-1", ...subscription } as SubscriptionRow,
      { enforced: true },
    );
  return {
    requireFeature: async (_accountId: string, feature: "apiAccess") =>
      assertFeature(access(), feature),
    requireWritable: async () => assertWritable(access()),
  };
});

const { requireApiKey } = await import("./api-context");

const KEY = generateApiKey().plaintext;

function request(method: string): Request {
  return new Request("https://crm.example.com/api/v1/contacts", {
    method,
    headers: { authorization: `Bearer ${KEY}` },
  });
}

async function billingCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(BillingError);
    return (err as BillingError).code;
  }
}

beforeEach(() => {
  __resetRateLimitForTests();
  findActiveKeyByHash.mockResolvedValue({
    id: "key-1",
    account_id: "acct-1",
    created_by: "user-1",
    name: "Test key",
    scopes: ["contacts:read", "contacts:write"],
    expires_at: null,
    revoked_at: null,
  });
});

afterEach(() => {
  __resetRateLimitForTests();
});

describe("requireApiKey plan gate", () => {
  it("allows reads and writes on a plan that includes the API", async () => {
    subscription = { plan: "growth", status: "active" };
    expect(await billingCode(requireApiKey(request("GET")))).toBeNull();
    expect(await billingCode(requireApiKey(request("POST")))).toBeNull();
  });

  it("refuses every request on a plan without API access", async () => {
    subscription = { plan: "starter", status: "active" };
    expect(await billingCode(requireApiKey(request("GET")))).toBe(
      "feature_unavailable",
    );
    expect(await billingCode(requireApiKey(request("POST")))).toBe(
      "feature_unavailable",
    );
  });

  it("keeps reads but refuses writes once the trial has ended", async () => {
    subscription = {
      plan: "trial",
      status: "trialing",
      trial_ends_at: "2020-01-01T00:00:00Z",
    };
    expect(await billingCode(requireApiKey(request("GET")))).toBeNull();
    for (const method of ["POST", "PATCH", "DELETE"]) {
      expect(await billingCode(requireApiKey(request(method)))).toBe(
        "subscription_inactive",
      );
    }
  });
});
