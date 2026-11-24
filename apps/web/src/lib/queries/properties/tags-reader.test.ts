import { CombinedError } from '@urql/core';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const live = vi.hoisted(() => ({
  /** The live query's current state, set by each test. */
  state: undefined as
    | undefined
    | {
        data: () => unknown;
        error: () => CombinedError | undefined;
      },
}));

vi.mock('@core/auth', () => ({ useIsAuthenticated: () => () => true }));

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({}),
}));

vi.mock('@graphql-cache/solid/create-live-query', () => ({
  createLiveQuery: () => ({
    get data() {
      return live.state?.data();
    },
    get error() {
      return live.state?.error();
    },
    isFetching: false,
    refetch: async () => {},
  }),
}));

import { catalogReaders } from './catalog/readers';
import { useTagsQuery } from './tags';

const SET = { scope: 'team', definition: { id: 'def-team' }, options: [] };

describe('the tag list as a reader', () => {
  it('offers the sets it shows only while its read has not failed', () => {
    const [data] = createSignal<unknown>([SET]);
    const [error, setError] = createSignal<CombinedError | undefined>();
    live.state = { data, error };
    createRoot((dispose) => {
      useTagsQuery();
      const reader = catalogReaders().find((each) => each.kind === 'tags');
      if (reader?.kind !== 'tags') throw new Error('no tag reader');
      expect(reader.sets()).toEqual([SET]);
      // A refusal before GraphQL (an HTTP 403) leaves the last sets on
      // screen; they are no longer evidence of a set.
      setError(
        new CombinedError({
          networkError: new Error('refused'),
          response: { status: 403 },
        })
      );
      expect(reader.sets()).toEqual([]);
      setError(
        new CombinedError({
          graphQLErrors: [{ message: 'not visible' }],
        })
      );
      expect(reader.sets()).toEqual([]);
      dispose();
    });
  });
});
