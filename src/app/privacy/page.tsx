export const metadata = {
  title: 'Privacy Policy — Relay',
}

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-foreground">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated: July 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-foreground">What we collect</h2>
          <p className="mt-2 text-muted-foreground">
            Relay is a customer relationship management tool that connects to the
            WhatsApp Business API on your behalf. We store the contacts, messages,
            deals, and account information you and your team enter into Relay,
            along with messages exchanged with your customers over WhatsApp.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">How we use it</h2>
          <p className="mt-2 text-muted-foreground">
            Data is used solely to operate Relay for your business: displaying
            your inbox, contacts, pipelines, and broadcasts, and to send and
            receive WhatsApp messages through your connected WhatsApp Business
            Account. We do not sell or share your data with third parties for
            marketing purposes.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Storage &amp; security</h2>
          <p className="mt-2 text-muted-foreground">
            Data is stored in a Supabase-hosted PostgreSQL database with
            row-level security. Access tokens for WhatsApp are encrypted at
            rest using AES-256-GCM.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Contact</h2>
          <p className="mt-2 text-muted-foreground">
            For questions about this policy or your data, contact the account
            owner of your Relay workspace.
          </p>
        </section>
      </div>
    </main>
  )
}
