import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createdEvent } from '../queries/fixtures';
import { createMockActivityContext } from '../tests/mock-context';
import { soupPage } from '../tests/wire';
import {
  createEntityActivityState,
  type EntityActivityState,
} from './entity-activity';

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

function setup(entityType: 'DOCUMENT' | 'USER' = 'DOCUMENT') {
  const context = createMockActivityContext();
  let state!: EntityActivityState;
  const dispose = createRoot((rootDispose) => {
    state = createEntityActivityState(context, {
      entityId: () => 'doc-1',
      entityType: () => entityType,
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
});
