import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  TimeSummaryDocument,
  type TimeSummaryFieldsFragment,
  type TimeSummaryInput,
  type TimeSummaryQuery,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import type { Accessor } from 'solid-js';

export type TimeSummary = TimeSummaryFieldsFragment;

function summaryOf(data: TimeSummaryQuery): TimeSummary {
  return data.user.timeSummary;
}

/**
 * A summary of logged time, read from the primary so it shows a write just
 * made. Changing the period or grouping keeps the last summary on screen
 * until the next one arrives.
 */
export function createTimeSummaryQuery(
  input: Accessor<TimeSummaryInput | undefined>,
  client: Accessor<Client>
) {
  const query = createLiveQuery(
    TimeSummaryDocument,
    () => {
      const value = input();
      return value ? { input: value } : undefined;
    },
    () => ({
      client: client(),
      requestPolicy: 'cache-and-network',
      select: summaryOf,
    })
  );
  return {
    summary: (): TimeSummary | undefined =>
      query.isPending ? undefined : query.data,
    /** No summary yet, so nothing can be shown for it. */
    pending: () => query.isPending,
    /** The read failed with nothing to show; a failed refetch keeps the last one. */
    failed: () => query.isError && query.data === undefined,
    refetch: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}

export type TimeSummaryRead = ReturnType<typeof createTimeSummaryQuery>;
