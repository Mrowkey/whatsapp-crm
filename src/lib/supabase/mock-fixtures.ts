// Sample rows for the auth-disabled local demo mode ONLY (see
// `@/lib/auth/mode` + `./mock`). Nothing here is reachable when the app
// talks to a real Supabase project — it exists so the UI can be
// exercised without credentials. Timestamps are relative to "now" so
// the 24-hour reply-window states stay demonstrable.

const DEMO_USER_ID = 'local-demo-user'
const DEMO_ACCOUNT_ID = 'local-demo-account'

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

const tag = (id: string, name: string, color: string) => ({
  id,
  user_id: DEMO_USER_ID,
  account_id: DEMO_ACCOUNT_ID,
  name,
  color,
  created_at: minutesAgo(60 * 24 * 30),
})

const TAGS = [
  tag('tag-hot', 'Hot lead', '#E5484D'),
  tag('tag-new', 'New inquiry', '#3E63DD'),
  tag('tag-vip', 'VIP', '#F5A524'),
]

const contact = (
  id: string,
  name: string,
  phone: string,
  extra: Record<string, unknown> = {},
  tagIds: string[] = [],
) => ({
  id,
  user_id: DEMO_USER_ID,
  account_id: DEMO_ACCOUNT_ID,
  name,
  phone,
  opted_in: true,
  created_at: minutesAgo(60 * 24 * 40),
  updated_at: minutesAgo(60),
  contact_tags: tagIds.map((tid) => ({ tags: TAGS.find((t) => t.id === tid) ?? null })),
  ...extra,
})

const CONTACTS = [
  contact('ct-1', 'Sample Customer One', '+1 555 010 0101', { company: 'Northwind Demo', email: 'one@example.com' }, ['tag-hot', 'tag-new']),
  contact('ct-2', 'Sample Customer Two', '+1 555 010 0102', { company: 'Contoso Demo' }, ['tag-vip']),
  contact('ct-3', 'Sample Customer Three', '+1 555 010 0103', { opted_in: false }),
  contact('ct-4', '', '+1 555 010 0104'),
]

const conversation = (
  id: string,
  contactId: string,
  extra: Record<string, unknown>,
) => ({
  id,
  user_id: DEMO_USER_ID,
  account_id: DEMO_ACCOUNT_ID,
  contact_id: contactId,
  status: 'open',
  unread_count: 0,
  created_at: minutesAgo(60 * 24 * 3),
  updated_at: minutesAgo(5),
  contact: CONTACTS.find((c) => c.id === contactId),
  ...extra,
})

const CONVERSATIONS = [
  conversation('cv-1', 'ct-1', {
    assigned_agent_id: DEMO_USER_ID,
    last_message_text: 'Great, thank you! Should I bring the documents?',
    last_message_at: minutesAgo(4),
    unread_count: 2,
  }),
  conversation('cv-2', 'ct-2', {
    status: 'pending',
    last_message_text: 'Could you send the brochure again?',
    last_message_at: minutesAgo(95),
    unread_count: 1,
  }),
  conversation('cv-3', 'ct-3', {
    assigned_agent_id: DEMO_USER_ID,
    last_message_text: 'Thanks, the offer looks good.',
    last_message_at: minutesAgo(60 * 30),
  }),
  conversation('cv-4', 'ct-4', {
    status: 'closed',
    last_message_text: 'Order update',
    last_message_at: minutesAgo(60 * 24 * 9),
  }),
]

const message = (
  id: string,
  conversationId: string,
  senderType: 'customer' | 'agent' | 'bot',
  text: string,
  ago: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  conversation_id: conversationId,
  sender_type: senderType,
  content_type: 'text',
  content_text: text,
  status: senderType === 'customer' ? 'delivered' : 'read',
  created_at: minutesAgo(ago),
  ...extra,
})

const MESSAGES = [
  message('m-1', 'cv-1', 'customer', 'Hi! Is the three-bedroom unit still available?', 60),
  message('m-2', 'cv-1', 'bot', 'Thanks for reaching out. An agent will be with you shortly.', 59),
  message('m-3', 'cv-1', 'agent', 'Hello! Yes it is. Would you like to book a viewing this weekend?', 52),
  message('m-4', 'cv-1', 'customer', 'Yes, Saturday morning works.', 40),
  message('m-5', 'cv-1', 'agent', 'Booked for Saturday at 10:00. I will send the address the day before.', 38, { status: 'delivered' }),
  message('m-6', 'cv-1', 'agent', 'Here is the floor plan link: https://example.com/a-very-long-link-that-should-wrap-inside-the-bubble-without-breaking-the-layout', 36, { status: 'failed' }),
  message('m-7', 'cv-1', 'customer', 'Great, thank you! Should I bring the documents?', 4),
  message('m-8', 'cv-2', 'agent', 'Our spring catalogue is ready for you.', 60 * 5, { content_type: 'template', template_name: 'spring_catalogue' }),
  message('m-9', 'cv-2', 'customer', 'Could you send the brochure again?', 95),
  message('m-10', 'cv-3', 'customer', 'Thanks, the offer looks good.', 60 * 30),
]

const DEALS = [
  {
    id: 'deal-1',
    user_id: DEMO_USER_ID,
    contact_id: 'ct-1',
    title: 'Sample deal',
    value: 412000,
    currency: 'USD',
    status: 'open',
    created_at: minutesAgo(60 * 24 * 2),
    stage: { id: 'st-1', name: 'Qualified', color: '#3E63DD', position: 1 },
  },
]

const NOTES = [
  {
    id: 'note-1',
    contact_id: 'ct-1',
    user_id: DEMO_USER_ID,
    note_text: 'Prefers morning appointments.',
    created_at: minutesAgo(60 * 20),
  },
]

const CONTACT_TAGS = CONTACTS.flatMap((c) =>
  c.contact_tags.map((ct, i) => ({
    id: `${c.id}-ct-${i}`,
    contact_id: c.id,
    tag_id: ct.tags?.id,
    tags: ct.tags,
  })),
)

/** Table name → sample rows. Tables not listed read as empty. */
export const MOCK_FIXTURES: Record<string, Array<Record<string, unknown>>> = {
  tags: TAGS,
  contacts: CONTACTS,
  conversations: CONVERSATIONS,
  messages: MESSAGES,
  deals: DEALS,
  contact_notes: NOTES,
  contact_tags: CONTACT_TAGS,
}
