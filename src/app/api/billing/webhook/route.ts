// ============================================================
// POST /api/billing/webhook — payment provider → subscription state.
//
// Unauthenticated by design (the provider calls it); trust comes from
// the signature over the RAW body, so the body is read as text and
// never re-serialised before verification.
//
// Status codes drive the provider's retry behaviour:
//   200 — handled, a duplicate, or an event we don't act on
//   400 — bad signature / malformed (retrying won't help)
//   500 — our failure applying it (provider retries)
//   503 — billing isn't configured here
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getBillingProvider } from "@/lib/billing/get-provider";
import { WebhookVerificationError } from "@/lib/billing/provider";
import { handleBillingEvent } from "@/lib/billing/webhook";

export async function POST(request: Request) {
  const provider = getBillingProvider();
  if (!provider) {
    return NextResponse.json(
      { error: "Billing is not configured" },
      { status: 503 },
    );
  }

  const rawBody = await request.text();

  try {
    const event = await provider.parseWebhook(rawBody, request.headers);
    const outcome = await handleBillingEvent(supabaseAdmin(), event);
    return NextResponse.json({ received: true, outcome });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      console.warn("[POST /api/billing/webhook] rejected:", err.message);
      return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
    }
    console.error("[POST /api/billing/webhook] processing error:", err);
    return NextResponse.json(
      { error: "Webhook handling failed" },
      { status: 500 },
    );
  }
}
