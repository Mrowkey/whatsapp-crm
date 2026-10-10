import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingError } from "@/lib/billing/entitlements";

// POST /api/contacts — the dashboard's contact-create path. What matters
// here: the plan limit is checked for the whole batch BEFORE anything is
// inserted, and a refusal reaches the client as a 402.

const inserted: Array<Record<string, unknown>[]> = [];
let insertResult: { data: unknown; error: unknown } = { data: [], error: null };

const supabase = {
  from: (table: string) => {
    expect(table).toBe("contacts");
    return {
      insert: (rows: Record<string, unknown>[]) => {
        inserted.push(rows);
        return { select: async () => insertResult };
      },
    };
  },
};

const requireRole = vi.fn();
vi.mock("@/lib/auth/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/account")>();
  return { ...actual, requireRole: (min: string) => requireRole(min) };
});

const requireWithinLimit = vi.fn();
vi.mock("@/lib/billing/guard", () => ({
  requireWithinLimit: (...args: unknown[]) => requireWithinLimit(...args),
}));

const { POST } = await import("./route");

function post(body: unknown): Request {
  return new Request("https://crm.example.com/api/contacts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  inserted.length = 0;
  insertResult = { data: [{ id: "c-1" }, { id: "c-2" }], error: null };
  requireRole.mockReset().mockResolvedValue({
    supabase,
    userId: "user-1",
    accountId: "acct-1",
    role: "agent",
  });
  requireWithinLimit.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/contacts", () => {
  it("creates the batch as the caller, in the caller's account", async () => {
    const res = await POST(
      post({
        contacts: [
          { phone: " +14155550123 ", name: "Jane", opted_in: false },
          { phone: "+14155550124", account_id: "someone-else" },
        ],
      }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ contacts: [{ id: "c-1" }, { id: "c-2" }] });
    expect(requireRole).toHaveBeenCalledWith("agent");
    expect(requireWithinLimit).toHaveBeenCalledWith("acct-1", "contacts", 2);
    expect(inserted[0]).toEqual([
      {
        user_id: "user-1",
        account_id: "acct-1",
        phone: "+14155550123",
        name: "Jane",
        email: null,
        company: null,
        opted_in: false,
      },
      {
        user_id: "user-1",
        // A client-supplied account_id is never trusted.
        account_id: "acct-1",
        phone: "+14155550124",
        name: null,
        email: null,
        company: null,
      },
    ]);
  });

  it("returns 402 and inserts nothing when the plan limit is reached", async () => {
    requireWithinLimit.mockRejectedValue(
      new BillingError("limit_reached", "You've reached your limit", {
        plan: "trial",
        limit: "contacts",
        max: 1000,
        used: 1000,
      }),
    );

    const res = await POST(post({ contacts: [{ phone: "+14155550123" }] }));

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      code: "limit_reached",
      limit: "contacts",
      max: 1000,
    });
    expect(inserted).toHaveLength(0);
  });

  it("returns 402 when the workspace is read-only", async () => {
    requireWithinLimit.mockRejectedValue(
      new BillingError("subscription_inactive", "Your free trial has ended.", {
        plan: "trial",
      }),
    );
    const res = await POST(post({ contacts: [{ phone: "+14155550123" }] }));
    expect(res.status).toBe(402);
    expect(inserted).toHaveLength(0);
  });

  it("rejects a malformed body before checking the plan", async () => {
    for (const body of [{}, { contacts: [] }, { contacts: [{ name: "No phone" }] }]) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
    }
    const tooMany = Array.from({ length: 101 }, () => ({ phone: "+14155550123" }));
    expect((await POST(post({ contacts: tooMany }))).status).toBe(400);
    expect(requireWithinLimit).not.toHaveBeenCalled();
  });

  it("passes a duplicate phone back as a 409 with the Postgres code", async () => {
    insertResult = { data: null, error: { code: "23505", message: "duplicate" } };
    const res = await POST(post({ contacts: [{ phone: "+14155550123" }] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "23505" });
  });
});
