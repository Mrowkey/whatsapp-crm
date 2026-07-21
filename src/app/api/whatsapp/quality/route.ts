import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

/**
 * GET /api/whatsapp/quality
 *
 * Live read of the connected number's Meta-side health — quality
 * rating, display-name approval, and messaging tier — so an account
 * owner can self-monitor daily sending without leaving Relay. Purely
 * informational: never written to the DB, always a fresh Graph API
 * call. Any member may read it (same posture as the WhatsApp config
 * GET), since it's non-sensitive account health, not credentials.
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ connected: false }, { status: 200 })
    }

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle()
    if (!config) {
      return NextResponse.json({ connected: false }, { status: 200 })
    }

    try {
      const accessToken = decrypt(config.access_token)
      const info = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
      return NextResponse.json({
        connected: true,
        quality_rating: info.quality_rating ?? null,
        name_status: info.name_status ?? null,
        messaging_limit_tier: info.messaging_limit_tier ?? null,
      })
    } catch (err) {
      // Meta being unreachable / a bad token shouldn't break the
      // Settings page — surface as "unavailable", not a hard error.
      console.error('[whatsapp/quality] Meta lookup failed:', err)
      return NextResponse.json({ connected: true, unavailable: true })
    }
  } catch (err) {
    console.error('[whatsapp/quality] unexpected error:', err)
    return NextResponse.json({ error: 'Failed to load account health' }, { status: 500 })
  }
}
