import { createUrqlInfiniteQuery } from '@app/lib/urql-solid/create-urql-infinite-query';
import {
  WorkFeedDocument,
  type WorkFeedQuery,
  type WorkFeedQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import type { Accessor } from 'solid-js';
import type { WorkFeedEntry, WorkFeedScope } from '../core/work-feed';
import { decodeWorkFeedEntry, encodeWorkFeedScope } from './decode';

/** Entries fetched per feed page. */
export const WORK_FEED_PAGE_LIMIT = 50;

const isEntry = (entry: WorkFeedEntry | null): entry is WorkFeedEntry =>
  entry !== null;

/** The variables of the feed page that starts at `cursor`. */
export const workFeedPageVariables = (
  scope: WorkFeedScope,
  cursor: string | null
): WorkFeedQueryVariables => ({
  input: {
    scope: encodeWorkFeedScope(scope),
    limit: WORK_FEED_PAGE_LIMIT,
    cursor,
  },
});

/** The loaded feed: its decoded rows and the cursor of each page. */
export type WorkFeedPages = {
  entries: WorkFeedEntry[];
  cursors: (string | null)[];
};

/**
 * Infinite query over one work feed, newest first. Pages chase the server's
 * opaque keyset cursor until it comes back null; the server merges
 * attention and own work, so one cursor covers both.
 */
export function createWorkFeedQuery(options: {
  client: Accessor<Client>;
  scope: Accessor<WorkFeedScope>;
  enabled: Accessor<boolean>;
}) {
  return createUrqlInfiniteQuery<
    WorkFeedQuery,
    WorkFeedQueryVariables,
    string | null,
    WorkFeedPages
  >(() => {
    const scope = options.scope();
    return {
      query: WorkFeedDocument,
      client: options.client(),
      initialPageParam: null,
      variables: (cursor) => workFeedPageVariables(scope, cursor),
      getNextPageParam: (lastPage) =>
        lastPage.user.workFeed.nextCursor ?? undefined,
      enabled: options.enabled(),
      requestPolicy: 'cache-and-network',
      keepPreviousData: true,
      select: ({ pages, pageParams }) => ({
        entries: pages
          .flatMap((page) => page.user.workFeed.entries)
          .map(decodeWorkFeedEntry)
          .filter(isEntry),
        cursors: [...pageParams],
      }),
    };
  });
}
