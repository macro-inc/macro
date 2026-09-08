import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createdEvent, editedEvent } from '../queries/fixtures';
import { createMockActivityContext } from '../tests/mock-context';
import { feedPage, overviewPage } from '../tests/wire';
import { createMyActivityState, type MyActivityState } from './my-activity';

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

function setup() {
  const context = createMockActivityContext();
  let state!: MyActivityState;
  const dispose = createRoot((rootDispose) => {
    state = createMyActivityState(context);
    return rootDispose;
  });
  disposals.push(dispose);
  return { context, state, graphql: context.graphqlMock };
}

describe('createMyActivityState', () => {
  it('starts loading and issues both queries', () => {
    const { state, graphql } = setup();

    expect(state.feed().t).toBe('loading');
    expect(state.overview().t).toBe('loading');
    expect(graphql.pending.map((op) => op.name).sort()).toEqual([
      'MyActivity',
      'MyActivityOverview',
    ]);
    expect(graphql.latest('MyActivity').variables).toEqual({
      input: { limit: 50, cursor: null },
    });
    expect(graphql.latest('MyActivityOverview').variables).toEqual({
      input: { timeZone: expect.any(String) },
    });
  });

  it('groups a page into a ready feed and exposes the next cursor', () => {
    const { state, graphql } = setup();

    graphql.latest('MyActivity').resolve(feedPage([createdEvent], 'c2'));

    const feed = state.feed();
    expect(feed.t).toBe('ready');
    if (feed.t !== 'ready') return;
    expect(feed.hasMore).toBe(true);
    expect(feed.loadingMore).toBe(false);
    expect(feed.groups.flatMap((g) => g.events.map((e) => e.id))).toEqual([
      'evt-1',
    ]);
  });

  it('appends the next page on loadMore', () => {
    const { state, graphql } = setup();
    graphql.latest('MyActivity').resolve(feedPage([createdEvent], 'c2'));

    state.loadMore();
    const next = graphql.latest('MyActivity');
    expect(next.variables).toEqual({ input: { limit: 50, cursor: 'c2' } });
    next.resolve(feedPage([editedEvent], null));

    const feed = state.feed();
    if (feed.t !== 'ready') throw new Error(feed.t);
    expect(feed.groups.flatMap((g) => g.events.map((e) => e.id))).toEqual([
      'evt-1',
      'evt-2',
    ]);
    expect(feed.hasMore).toBe(false);
  });

  it('is empty when the first page has no rows', () => {
    const { state, graphql } = setup();
    graphql.latest('MyActivity').resolve(feedPage([]));
    expect(state.feed()).toEqual({ t: 'empty' });
  });

  it('reports an error when the feed fails before any data', () => {
    const { state, graphql } = setup();
    graphql.latest('MyActivity').fail('boom');
    expect(state.feed()).toEqual({ t: 'error' });
  });

  it('decodes the overview and keeps it over a later error', () => {
    const { state, graphql } = setup();
    const op = graphql.latest('MyActivityOverview');

    op.fail('boom');
    expect(state.overview()).toEqual({ t: 'error' });

    op.resolve(overviewPage({ total: 3 }));
    const overview = state.overview();
    if (overview.t !== 'ready') throw new Error(overview.t);
    expect(overview.overview.total).toBe(3);
  });
});
