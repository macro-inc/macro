import { describe, expect, it } from 'vitest';
import {
  collectNetworkItems,
  layoutActivityNetwork,
  mergeActivityEvents,
  NETWORK_ITEM_LIMIT,
} from './activity-network';
import type { ActivityEvent } from './event';

const event = (
  id: string,
  actorId: string,
  entityId = 'doc',
  entityType: ActivityEvent['entityType'] = 'document'
): ActivityEvent => ({
  id,
  actorId,
  entityId,
  entityType,
  occurredAt: '2026-09-01T12:00:00Z',
  action: { kind: 'edited' },
});
const options = {
  currentUserId: 'me',
  teamIds: ['me', 'jackson', 'julia', 'no-history'],
  personIds: ['me', 'jackson', 'julia', 'no-history'],
};

describe('people work graph', () => {
  it('deduplicates histories and co-locates mixed work around a teammate', () => {
    const shared = event('1', 'jackson');
    const items = collectNetworkItems(
      mergeActivityEvents(
        [shared],
        [shared, event('2', 'me'), event('3', 'jackson', 'channel', 'channel')]
      )
    );
    expect(items.flatMap((item) => item.events)).toHaveLength(3);
    const graph = layoutActivityNetwork(items, options);
    const group = graph.clusters.find((c) => c.id === 'jackson')!;
    expect(group.nodes.map((n) => n.entityType)).toEqual([
      'document',
      'channel',
    ]);
    expect(graph.itemCount).toBe(2);
    expect(graph.connectionCount).toBe(3);
  });

  it('represents each person and shared item once, including teammates without sampled work', () => {
    const items = collectNetworkItems([
      event('1', 'me'),
      event('2', 'jackson'),
      event('3', 'julia'),
      event('4', 'julia', 'other'),
    ]);
    const graph = layoutActivityNetwork(items, options);
    const people = graph.clusters.flatMap((c) => c.people);
    expect(new Set(people.map((p) => p.id)).size).toBe(people.length);
    expect(graph.clusters.flatMap((c) => c.nodes)).toHaveLength(2);
    expect(people.find((p) => p.id === 'no-history')?.connectedCount).toBe(0);
    expect(people.find((p) => p.id === 'julia')?.connectedCount).toBe(2);
  });

  it('uses email participants for edges instead of the activity actor', () => {
    const [item] = collectNetworkItems([
      event('1', 'me', 'email', 'email-thread'),
    ]);
    const graph = layoutActivityNetwork(
      [
        {
          ...item,
          actors: ['jackson', 'contact:sandra'],
          relationships: [
            { personId: 'jackson', label: 'received', count: 1 },
            { personId: 'contact:sandra', label: 'sent', count: 1 },
          ],
        },
      ],
      options
    );
    const group = graph.clusters.find((c) => c.id === 'jackson')!;
    expect(group.people.map((p) => p.id)).toContain('contact:sandra');
    expect(group.edges.map((e) => [e.actorId, e.label])).toEqual([
      ['jackson', 'received'],
      ['contact:sandra', 'sent'],
    ]);
  });

  it('keeps layout deterministic and bounds rendered work for a large feed', () => {
    const items = collectNetworkItems(
      Array.from({ length: 1000 }, (_, i) =>
        event(`${i}`, `actor-${i % 20}`, `doc-${i}`)
      )
    );
    const graph = layoutActivityNetwork(items, options);
    expect(graph.itemCount).toBe(NETWORK_ITEM_LIMIT);
    expect(graph.omittedItems).toBe(1000 - NETWORK_ITEM_LIMIT);
    expect(layoutActivityNetwork(items, options)).toEqual(graph);
    expect(graph.clusters.every((c) => c.nodes.length <= 6)).toBe(true);
  });

  it('does not invent a participant when email metadata is missing', () => {
    const [item] = collectNetworkItems([
      event('1', 'me', 'email', 'email-thread'),
    ]);
    const graph = layoutActivityNetwork(
      [{ ...item, actors: [], relationships: [] }],
      options
    );
    expect(graph.itemCount).toBe(0);
    expect(graph.connectionCount).toBe(0);
    expect(graph.peopleCount).toBe(options.personIds.length);
  });
});
