import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { AUTH_DISABLED } from '@/lib/auth/mode'
import { createMockSupabaseClient } from '@/lib/supabase/mock'

export async function createClient() {
  if (AUTH_DISABLED) {
    return createMockSupabaseClient()
  }

  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}
