import { describe, expect, it } from 'vitest';
import {
  buildPrLinks,
  derivePriority,
  hasPrLink,
  type PrLinkTask,
  priorityFromLabelName,
} from './pr-links';

const task = (overrides: Partial<PrLinkTask>): PrLinkTask => ({
  id: 'task',
  name: 'Task',
  priority: 'none',
  closed: false,
  companyIds: [],
  ...overrides,
});

describe('priorityFromLabelName', () => {
  it.each([
    ['P0', 'urgent'],
    ['p1', 'high'],
    ['priority: p2', 'medium'],
    ['P3', 'low'],
    ['priority: high', 'high'],
    ['Priority/Critical', 'urgent'],
    ['urgent', 'urgent'],
  ] as const)('reads %s as %s', (name, priority) => {
    expect(priorityFromLabelName(name)).toBe(priority);
  });

  it.each(['bug', 'p4', 'high-risk', 'enhancement'])('ignores %s', (name) => {
    expect(priorityFromLabelName(name)).toBeNull();
  });
});

describe('derivePriority', () => {
  it('takes the most urgent open task over closed ones and labels', () => {
    expect(
      derivePriority(
        [
          task({ id: 'done', priority: 'urgent', closed: true }),
          task({ id: 'low', priority: 'low' }),
          task({ id: 'high', priority: 'high' }),
        ],
        [{ name: 'P0' }]
      )
    ).toEqual({ id: 'high', source: 'task', taskId: 'high' });
  });

  it('falls back to closed tasks, then to GitHub labels', () => {
    expect(
      derivePriority(
        [task({ id: 'done', priority: 'medium', closed: true })],
        []
      )
    ).toEqual({ id: 'medium', source: 'task', taskId: 'done' });
    expect(
      derivePriority([task({})], [{ name: 'bug' }, { name: 'P1' }])
    ).toEqual({ id: 'high', source: 'label' });
    expect(derivePriority([], [])).toEqual({ id: 'none' });
  });
});

describe('buildPrLinks', () => {
  it('collects channels and customers from sessions and tasks', () => {
    const links = buildPrLinks({
      sessions: [
        { id: 's1', source: 'agent', parent: { type: 'channel', id: 'c1' } },
        { id: 's2', source: 'user', parent: { type: 'channel', id: 'c1' } },
        {
          id: 's3',
          source: 'user',
          parent: { type: 'crm_company', id: 'acme' },
        },
      ],
      tasks: [
        task({ id: 'closed', closed: true, companyIds: ['globex'] }),
        task({ id: 'open', priority: 'low', companyIds: ['acme'] }),
      ],
      labels: [],
    });

    expect(links.channelIds).toEqual(['c1']);
    expect(links.companyIds).toEqual(['acme', 'globex']);
    expect(links.tasks.map((linked) => linked.id)).toEqual(['open', 'closed']);
    expect(links.priority).toEqual({
      id: 'low',
      source: 'task',
      taskId: 'open',
    });
    expect(hasPrLink(links, 'agent')).toBe(true);
    expect(hasPrLink(links, 'customer')).toBe(true);
  });
});
