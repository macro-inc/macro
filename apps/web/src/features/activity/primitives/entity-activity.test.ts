import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createdEvent, databaseCreatedEvent } from '../queries/fixtures';
import { createMockActivityContext } from '../tests/mock-context';
import { soupPage } from '../tests/wire';
import {
  type ActivitySectionEntityType,
  createEntityActivityState,
  type EntityActivityState,
} from './entity-activity';

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

function setup(entityType: ActivitySectionEntityType = 'DOCUMENT') {
  const context = createMockActivityContext();
  let state!: EntityActivityState;
  const dispose = createRoot((rootDispose) => {
    state = createEntityActivityState(context, {
      entityId: () => 'doc-1',
      entityType,
    });
    return rootDispose;
  });
  disposals.push(dispose);
  return { state, graphql: context.graphqlMock };
}

describe('createEntityActivityState', () => {
  it('loads, then reads the matching soup item', () => {
    const { state, graphql } = setup();
    expect(state.isEnabled()).toBe(true);
    expect(state.view().t).toBe('loading');

    graphql.latest('EntityActivity').resolve(
      soupPage([
        {
          __typename: 'GraphqlSoupDocument',
          id: 'doc-1',
          activity: [createdEvent],
        },
      ])
    );

    const view = state.view();
    if (view.t !== 'ready') throw new Error(view.t);
    expect(view.events.map((e) => e.id)).toEqual(['evt-1']);
  });

  it('is empty when the entity exists with no history', () => {
    const { state, graphql } = setup();
    graphql
      .latest('EntityActivity')
      .resolve(
        soupPage([
          { __typename: 'GraphqlSoupDocument', id: 'doc-1', activity: [] },
        ])
      );
    expect(state.view()).toEqual({ t: 'empty' });
  });

  it('treats a missing soup entity as an error, not as empty', () => {
    const { state, graphql } = setup();
    graphql.latest('EntityActivity').resolve(soupPage([]));
    expect(state.view()).toEqual({ t: 'error' });
  });

  it('reports transport failures', () => {
    const { state, graphql } = setup();
    graphql.latest('EntityActivity').fail('boom');
    expect(state.view()).toEqual({ t: 'error' });
  });

  it('stays disabled for entity types the soup cannot address', () => {
    const { state, graphql } = setup('USER');
    expect(state.isEnabled()).toBe(false);
    expect(graphql.pending).toHaveLength(0);
  });

  it('reads a database by id, since databases are not soup items', () => {
    const { state, graphql } = setup('DATABASE');
    expect(state.isEnabled()).toBe(true);
    expect(graphql.pending.map((operation) => operation.name)).toEqual([
      'DatabaseActivity',
    ]);
    expect(graphql.latest('DatabaseActivity').variables).toEqual({
      databaseId: 'doc-1',
      limit: 20,
    });

    graphql.latest('DatabaseActivity').resolve({
      user: {
        id: 'user-1',
        databaseActivity: [databaseCreatedEvent],
      },
    });

    expect(state.view()).toEqual({
      t: 'ready',
      events: [
        {
          id: 'evt-13',
          actorId: 'macro|sarah@example.com',
          entityId: 'database-1',
          entityType: 'database',
          occurredAt: '2026-08-21T12:00:00.000Z',
          action: { kind: 'created' },
        },
      ],
    });
  });

  it('reads a database the viewer cannot see as an error', () => {
    const { state, graphql } = setup('DATABASE');
    graphql.latest('DatabaseActivity').fail('database not found');
    expect(state.view()).toEqual({ t: 'error' });
  });
});
