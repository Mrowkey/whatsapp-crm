import { describe, expect, it } from 'vitest'
import {
  computeMessageTotals,
  computeResponseTimes,
  computeWorkload,
  formatMinutes,
  formatRate,
  rate,
  summarizeCampaigns,
  type CampaignCounts,
  type MessageRow,
} from './compute'

const msg = (
  conversation_id: string,
  sender_type: string,
  created_at: string,
  status?: string,
): MessageRow => ({ conversation_id, sender_type, created_at, status })

describe('computeMessageTotals', () => {
  it('splits by direction and counts failed outbound only', () => {
    expect(
      computeMessageTotals([
        msg('a', 'customer', '2026-01-01T10:00:00Z', 'failed'),
        msg('a', 'agent', '2026-01-01T10:01:00Z', 'failed'),
        msg('a', 'bot', '2026-01-01T10:02:00Z', 'read'),
      ]),
    ).toEqual({ incoming: 1, outgoing: 2, failedOutgoing: 1 })
  })
})

describe('computeResponseTimes', () => {
  it('returns nulls, not zeros, when there is nothing to measure', () => {
    expect(computeResponseTimes([])).toEqual({
      samples: 0,
      avgMinutes: null,
      medianMinutes: null,
      within5MinRate: null,
      unanswered: 0,
    })
  })

  it('pairs the first customer message of a run with the next reply', () => {
    const stats = computeResponseTimes([
      msg('a', 'customer', '2026-01-01T10:00:00Z'),
      // Double-text must not start a second sample.
      msg('a', 'customer', '2026-01-01T10:03:00Z'),
      msg('a', 'agent', '2026-01-01T10:04:00Z'),
      msg('b', 'customer', '2026-01-01T11:00:00Z'),
      msg('b', 'bot', '2026-01-01T11:20:00Z'),
    ])
    expect(stats.samples).toBe(2)
    expect(stats.avgMinutes).toBe(12)
    expect(stats.medianMinutes).toBe(12)
    expect(stats.within5MinRate).toBe(0.5)
    expect(stats.unanswered).toBe(0)
  })

  it('counts conversations still waiting on a reply', () => {
    const stats = computeResponseTimes([
      msg('a', 'agent', '2026-01-01T09:00:00Z'),
      msg('a', 'customer', '2026-01-01T10:00:00Z'),
    ])
    expect(stats.samples).toBe(0)
    expect(stats.unanswered).toBe(1)
  })

  it('is independent of input order', () => {
    const stats = computeResponseTimes([
      msg('a', 'agent', '2026-01-01T10:10:00Z'),
      msg('a', 'customer', '2026-01-01T10:00:00Z'),
    ])
    expect(stats.avgMinutes).toBe(10)
  })
})

describe('rate', () => {
  it('is null for an empty denominator and clamped to 0..1', () => {
    expect(rate(5, 0)).toBeNull()
    expect(rate(5, 10)).toBe(0.5)
    expect(rate(12, 10)).toBe(1)
  })
})

describe('summarizeCampaigns', () => {
  const campaign = (over: Partial<CampaignCounts>): CampaignCounts => ({
    status: 'sent',
    total_recipients: 0,
    sent_count: 0,
    delivered_count: 0,
    read_count: 0,
    replied_count: 0,
    failed_count: 0,
    ...over,
  })

  it('reports null rates when nothing has been sent', () => {
    const s = summarizeCampaigns([campaign({ status: 'draft', total_recipients: 40 })])
    expect(s.campaigns).toBe(1)
    expect(s.recipients).toBe(40)
    expect(s.deliveryRate).toBeNull()
    expect(s.readRate).toBeNull()
    expect(s.failureRate).toBeNull()
  })

  it('aggregates counts across campaigns before taking rates', () => {
    const s = summarizeCampaigns([
      campaign({ total_recipients: 100, sent_count: 90, delivered_count: 81, read_count: 45, replied_count: 9, failed_count: 10 }),
      campaign({ total_recipients: 10, sent_count: 10, delivered_count: 9, read_count: 5, replied_count: 1 }),
    ])
    expect(s.sent).toBe(100)
    expect(s.deliveryRate).toBe(0.9)
    expect(s.readRate).toBe(0.5)
    expect(s.replyRate).toBe(0.1)
    expect(s.failureRate).toBeCloseTo(10 / 110)
  })
})

describe('computeWorkload', () => {
  it('lists every teammate, attributes load, and keeps Unassigned last', () => {
    const rows = computeWorkload(
      [
        { status: 'open', assigned_agent_id: 'u1', unread_count: 2 },
        { status: 'pending', assigned_agent_id: 'u1', unread_count: 0 },
        { status: 'closed', assigned_agent_id: 'u2', unread_count: 0 },
        { status: 'open', assigned_agent_id: null, unread_count: 1 },
        { status: 'open', assigned_agent_id: 'gone', unread_count: 0 },
      ],
      [
        { user_id: 'u1', full_name: 'Asha' },
        { user_id: 'u2', full_name: 'Bilal' },
        { user_id: 'u3', full_name: null },
      ],
    )
    expect(rows.map((r) => r.name)).toEqual([
      'Asha',
      'Former teammate',
      'Bilal',
      'Unnamed teammate',
      'Unassigned',
    ])
    expect(rows[0]).toMatchObject({ open: 1, pending: 1, closed: 0, unread: 1, total: 2 })
    expect(rows.at(-1)).toMatchObject({ userId: null, open: 1, unread: 1, total: 1 })
  })
})

describe('formatters', () => {
  it('formats durations compactly', () => {
    expect(formatMinutes(null)).toBe('No data')
    expect(formatMinutes(0.4)).toBe('<1m')
    expect(formatMinutes(42)).toBe('42m')
    expect(formatMinutes(72)).toBe('1h 12m')
    expect(formatMinutes(120)).toBe('2h')
    expect(formatMinutes(60 * 27)).toBe('1d 3h')
  })

  it('formats rates without inventing a value', () => {
    expect(formatRate(null)).toBe('No data')
    expect(formatRate(0.456)).toBe('46%')
  })
})
