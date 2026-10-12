// ============================================================
// POST /api/contacts — create one or more contacts. Agent+.
//
// The dashboard used to insert contacts straight from the browser
// (RLS-scoped). Creation now goes through this route so the plan's
// contact limit is checked on the server; the insert itself still
// runs as the calling user, so RLS and the phone-dedup unique index
// (migration 022) behave exactly as before.
//
// Body:     { "contacts": [{ phone, name?, email?, company?, opted_in? }] }  (1..100)
// Success:  201 { "contacts": [<contact row>] } — same order as the input
// Failure:  { "error": "…", "code": "…" }
//   402 — plan limit reached or workspace read-only (billing codes)
//   409 — code "23505": a phone already exists (nothing was inserted)
//
// The batch is all-or-nothing, matching a single multi-row INSERT;
// the CSV importer relies on that to fall back to row-by-row retries.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { requireWithinLimit } from "@/lib/billing/guard";

const MAX_BATCH = 100;

// Generous caps — these exist to keep junk out of the table, not to
// validate. Phone format is checked by the callers (E.164) as before.
const MAX_LEN = { phone: 32, name: 200, email: 320, company: 200 } as const;

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

    const body = (await request.json().catch(() => null)) as
      | { contacts?: unknown }
      | null;
    const input = body?.contacts;
    if (!Array.isArray(input) || input.length === 0 || input.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `'contacts' must be an array of 1 to ${MAX_BATCH} items` },
        { status: 400 },
      );
    }

    const rows: Record<string, unknown>[] = [];
    for (const item of input) {
      const raw = (item ?? {}) as Record<string, unknown>;
      const phone = optionalText(raw.phone);
      if (!phone) {
        return NextResponse.json(
          { error: "Every contact needs a 'phone'" },
          { status: 400 },
        );
      }
      const name = optionalText(raw.name);
      const email = optionalText(raw.email);
      const company = optionalText(raw.company);
      if (
        phone.length > MAX_LEN.phone ||
        (name?.length ?? 0) > MAX_LEN.name ||
        (email?.length ?? 0) > MAX_LEN.email ||
        (company?.length ?? 0) > MAX_LEN.company
      ) {
        return NextResponse.json(
          { error: "A contact field is too long" },
          { status: 400 },
        );
      }
      rows.push({
        user_id: ctx.userId,
        account_id: ctx.accountId,
        phone,
        name,
        email,
        company,
        // Left to the column default unless the caller states consent.
        ...(typeof raw.opted_in === "boolean" ? { opted_in: raw.opted_in } : {}),
      });
    }

    await requireWithinLimit(ctx.accountId, "contacts", rows.length);

    const { data, error } = await ctx.supabase
      .from("contacts")
      .insert(rows)
      .select("*");

    if (error || !data) {
      const duplicate = error?.code === "23505";
      if (!duplicate) {
        console.error("[POST /api/contacts] insert error:", error);
      }
      return NextResponse.json(
        {
          error: duplicate
            ? "A contact with this phone number already exists"
            : "Failed to create contact",
          code: error?.code ?? "internal",
        },
        { status: duplicate ? 409 : 500 },
      );
    }

    return NextResponse.json({ contacts: data }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
