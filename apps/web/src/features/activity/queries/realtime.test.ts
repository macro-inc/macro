import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { revalidateActivityQueries } from '../../../lib/queries/activity/push-registry';
import { createMockGraphql } from '../tests/mock-graphql';
import { feedPage, overviewPage } from '../tests/wire';
import { createMyActivityQuery } from './feed-query';
import { createdEvent } from './fixtures';
import { createMyActivityOverviewQuery } from './overview-query';

const disposals: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const row = (id: string) => ({ ...createdEvent, id });

describe('mounted activity realtime queries', () => {
  it('rebuilds loaded cursor pages without losing the shifted boundary row and refreshes overview', async () => {
    const graphql = createMockGraphql();
    const context = { graphql: () => graphql.client };
    const queries = createRoot((dispose) => {
      disposals.push(dispose);
      return {
        feed: createMyActivityQuery(context, { enabled: () => true }),
        overview: createMyActivityOverviewQuery(context, {
          enabled: () => true,
        }),
      };
    });
    graphql
      .latest('MyActivity')
      .resolve(feedPage([row('100'), row('99')], '99'));
    graphql.latest('MyActivityOverview').resolve(overviewPage());
    const more = queries.feed.fetchNextPage();
    graphql
      .latest('MyActivity')
      .resolve(feedPage([row('98'), row('97')], '97'));
    await more;
    const refresh = revalidateActivityQueries(
      graphql.client,
      new Set(['doc-1'])
    );
    expect(graphql.latest('MyActivity').variables).toEqual({
      input: { limit: 50, cursor: null },
    });
    graphql
      .latest('MyActivity')
      .resolve(feedPage([row('101'), row('100')], '100'));
    graphql.latest('MyActivityOverview').resolve(overviewPage());
    await settle();
    expect(graphql.latest('MyActivity').variables).toEqual({
      input: { limit: 50, cursor: '100' },
    });
    graphql
      .latest('MyActivity')
      .resolve(feedPage([row('99'), row('98')], '98'));
    await refresh;
    expect(queries.feed.data?.map((event) => event.id)).toEqual([
      '101',
      '100',
      '99',
      '98',
    ]);
    expect(
      graphql.pending.filter((op) => op.name === 'MyActivityOverview')
    ).toHaveLength(2);
  });
  it('binds query and registration to the same reactive client and removes the registration on disposal', async () => {
    const first = createMockGraphql(),
      second = createMockGraphql();
    const [client, setClient] = createSignal(first.client);
    let dispose!: () => void;
    createRoot((cleanup) => {
      dispose = cleanup;
      createMyActivityQuery({ graphql: client }, { enabled: () => true });
    });
    disposals.push(dispose);
    first.latest('MyActivity').resolve(feedPage([]));
    setClient(() => second.client);
    second.latest('MyActivity').resolve(feedPage([]));
    const firstCount = first.pending.length;
    await revalidateActivityQueries(first.client, null);
    expect(first.pending).toHaveLength(firstCount);
    const pending = revalidateActivityQueries(second.client, null);
    expect(second.pending).toHaveLength(2);
    second.latest('MyActivity').resolve(feedPage([]));
    await pending;
    dispose();
    await revalidateActivityQueries(second.client, null);
    expect(second.pending).toHaveLength(2);
  });
});
