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
 * made. After the input changes, `summary` keeps the last answer until the
 * next one arrives: compare its period before showing it as the new one.
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
    /** The latest read failed. */
    error: () => query.isError,
    refetch: () => query.refetch({ requestPolicy: 'network-only' }),
  };
}

export type TimeSummaryRead = ReturnType<typeof createTimeSummaryQuery>;
