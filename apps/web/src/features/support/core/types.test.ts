import { describe, expect, it } from 'vitest';
import { filterTickets, type Ticket } from './types';

const ticket = (
  id: string,
  status: Ticket['status'],
  priority: Ticket['priority'],
  assignee_id: string | null
): Ticket => ({
  id,
  team_id: 'team',
  channel_id: 'channel',
  subject: 'Webhook retry',
  customer: { name: 'Nina', email: 'nina@acme.com', company_name: 'Acme' },
  status,
  priority,
  assignee_id,
  source: 'email',
  agent_paused: false,
  draft: null,
  preview: 'Timeouts',
  created_at: '2026-10-01',
  updated_at: '2026-10-01',
});
const list = [
  ticket('1', 'open', 'urgent', 'me'),
  ticket('2', 'waiting_on_customer', 'high', null),
  ticket('3', 'resolved', 'high', 'me'),
  ticket('4', 'waiting_on_team', 'low', 'other'),
];
describe('Support queues', () => {
  it('keeps waiting states in the active inbox', () =>
    expect(filterTickets(list, 'open', '', 'me').map((t) => t.id)).toEqual([
      '4',
      '2',
      '1',
    ]));
  it('filters assignments and high priority without resolved tickets', () => {
    expect(filterTickets(list, 'mine', '', 'me').map((t) => t.id)).toEqual([
      '1',
    ]);
    expect(filterTickets(list, 'high', '', 'me').map((t) => t.id)).toEqual([
      '2',
      '1',
    ]);
    expect(
      filterTickets(list, 'unassigned', '', 'me').map((t) => t.id)
    ).toEqual(['2']);
  });
  it('searches CRM customer context and keeps resolution independent', () => {
    expect(filterTickets(list, 'all', 'ACME', 'me')).toHaveLength(4);
    expect(filterTickets(list, 'resolved', '', 'me').map((t) => t.id)).toEqual([
      '3',
    ]);
    expect(filterTickets(list, 'all', 'missing', 'me')).toHaveLength(0);
  });
});
