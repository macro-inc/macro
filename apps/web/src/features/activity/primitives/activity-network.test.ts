import type { ActivityWorkDetailsQuery } from '@service-storage/graphql/generated/graphql';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../core/event';
import {
  createMockActivityContext,
  MOCK_VIEWER_ID,
} from '../tests/mock-context';
import { createActivityNetworkState } from './activity-network';

const teammate = 'macro|jackson@example.com';
const disposals: Array<() => void> = [];
afterEach(() => disposals.splice(0).forEach((dispose) => dispose()));
function setup(events: ActivityEvent[]) {
  const context = createMockActivityContext({
    workspacePeople: () => ({
      memberIds: () => [MOCK_VIEWER_ID, teammate, 'macro|quiet@example.com'],
      ownEmails: () => ['alias@example.com'],
    }),
  });
  const state = createRoot((dispose) => {
    disposals.push(dispose);
    return createActivityNetworkState(
      context,
      () => events,
      () => []
    );
  });
  return { state, graphql: context.graphqlMock };
}
const event = (
  id: string,
  entityType: ActivityEvent['entityType'] = 'email-thread'
): ActivityEvent => ({
  id,
  actorId: MOCK_VIEWER_ID,
  entityId: id,
  entityType,
  occurredAt: new Date().toISOString(),
  action: { kind: 'edited' },
});
const email = {
  __typename: 'GraphqlSoupEmailThread' as const,
  id: 'email',
  displayName: 'Delaware',
  ownerId: MOCK_VIEWER_ID,
  linkId: 'link',
  participantCount: 2,
  participants: [],
  messages: [],
  latestInboundMessageTs: '2026-09-01T12:00:00Z',
  latestContentMessage: {
    id: 'message',
    isSent: false,
    replyingToId: null,
    sentAt: null,
    internalDateTs: '2026-09-01T12:00:00Z',
    from: { email: 'sandra@example.com', name: 'Sandra', photoUrl: null },
    to: [
      { email: 'jackson@example.com', name: 'Jackson', photoUrl: null },
      { email: 'alias@example.com', name: 'Me', photoUrl: null },
    ],
    cc: [],
  },
};
function resolveEmail(graphql: ReturnType<typeof setup>['graphql']) {
  graphql.latest('ActivityWorkDetails').resolve({
    user: { id: MOCK_VIEWER_ID, soup: { items: [email] } },
  } satisfies ActivityWorkDetailsQuery);
}

describe('activity network state', () => {
  it('excludes AI conversations and keeps the team roster without fabricating activity', () => {
    const { state } = setup([event('ai', 'chat'), event('doc', 'document')]);
    expect(state.timeline().map((e) => e.id)).toEqual(['doc']);
    expect(state.graph().peopleCount).toBe(3);
    state.select({ kind: 'person', id: 'macro|quiet@example.com' });
    expect(state.selectedWork()).toEqual([]);
    expect(state.timeline()).toEqual([]);
  });

  it('connects emails to actual participants, and selecting a contact shows related work and history', () => {
    const { state, graphql } = setup([event('email')]);
    expect(state.graph().connectionCount).toBe(0);
    resolveEmail(graphql);
    const edges = state.graph().clusters.flatMap((c) => c.edges);
    expect(edges.map((e) => e.actorId)).toEqual([
      'contact:sandra@example.com',
      teammate,
    ]);
    state.select({ kind: 'person', id: teammate });
    expect(state.selectedWork().map((i) => i.entityId)).toEqual(['email']);
    expect(state.timeline().map((e) => e.id)).toEqual(['email']);
    state.select({ kind: 'entity', id: 'email-thread:email' });
    expect(state.selectedEmail()?.replyState).toBe('unanswered');
  });

  it('filters by reply state, teammate, and contact search without fetching per node', () => {
    const { state, graphql } = setup([
      event('email'),
      event('doc', 'document'),
    ]);
    resolveEmail(graphql);
    const requests = graphql.pending.length;
    state.setFocus('unanswered');
    expect(state.graph().itemCount).toBe(1);
    expect(state.timeline().map((e) => e.id)).toEqual(['email']);
    state.setFocus('shared');
    expect(state.graph().itemCount).toBe(1);
    state.setSearch('sandra@example.com');
    expect(state.graph().itemCount).toBe(1);
    state.setSearch('not-on-this-chain');
    expect(state.graph().itemCount).toBe(0);
    expect(state.timeline()).toEqual([]);
    expect(graphql.pending).toHaveLength(requests);
  });

  it('bounds email metadata loading to one batch of sixteen headers', () => {
    const { graphql } = setup(
      Array.from({ length: 100 }, (_, i) => event(`email-${i}`))
    );
    const requests = graphql.pending.filter(
      (op) => op.name === 'ActivityWorkDetails'
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].variables).toMatchObject({
      input: { initial: { limit: 16 } },
      messageLimit: 5,
    });
  });
});
