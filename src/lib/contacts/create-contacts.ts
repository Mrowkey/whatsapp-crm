// ============================================================
// Browser helper for POST /api/contacts.
//
// Returns the same `{ data, error }` pair a Supabase insert does, with
// the Postgres error `code` preserved, so the call sites that used to
// insert directly keep their duplicate handling (`isUniqueViolation`).
// `error.status === 402` means the plan stopped it — the message is
// ready to show as-is.
// ============================================================

export interface NewContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  opted_in?: boolean;
}

export interface CreateContactsError {
  message: string;
  code: string;
  status: number;
}

export async function createContacts(
  contacts: NewContactInput[],
): Promise<
  | { data: { id: string }[]; error: null }
  | { data: null; error: CreateContactsError }
> {
  try {
    const res = await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts }),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      contacts?: { id: string }[];
      error?: string;
      code?: string;
    };
    if (!res.ok || !payload.contacts) {
      return {
        data: null,
        error: {
          message: payload.error || 'Failed to create contact',
          code: payload.code || 'internal',
          status: res.status,
        },
      };
    }
    return { data: payload.contacts, error: null };
  } catch {
    return {
      data: null,
      error: { message: 'Could not reach the server', code: 'network', status: 0 },
    };
  }
}

/** True when the plan (limit or read-only workspace) refused the create. */
export function isBillingBlock(error: CreateContactsError | null): boolean {
  return error?.status === 402;
}
