import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import type { GithubPullRequestMergeability } from '@service-auth/generated/schemas';
import { queryOptions, skipToken, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import type { PrRef } from '../util/prKey';
import { prMergeabilityQueryKey } from './keys';

export { prMergeabilityQueryKey } from './keys';

const UNKNOWN_REFETCH_INTERVAL = 3_000;
const MAX_UNKNOWN_REFETCHES = 3;

type PrMergeabilityData = {
  state: GithubPullRequestMergeability;
  refetches: number;
};

/** Keep GitHub's lazy computation bounded, without blocking on unknown or errors. */
export function prMergeabilityQueryOptions(id: string, reference?: PrRef) {
  return queryOptions({
    queryKey: [
      ...prMergeabilityQueryKey(id),
      reference?.owner,
      reference?.repo,
      reference?.number,
    ] as const,
    queryFn: reference
      ? async (context): Promise<PrMergeabilityData> => {
          const previous = context.client.getQueryData<PrMergeabilityData>(
            context.queryKey
          );
          const invalidated = context.client.getQueryState(
            context.queryKey
          )?.isInvalidated;
          const response = await throwOnErr(() =>
            authServiceClient.getGithubPullRequestMergeability({
              pullRequests: [
                {
                  owner: reference.owner,
                  repo: reference.repo,
                  number: reference.number,
                },
              ],
            })
          );
          const state = response.pullRequests[0]?.mergeability ?? 'unknown';
          return {
            state,
            refetches:
              state === 'unknown' &&
              previous?.state === 'unknown' &&
              !invalidated
                ? previous.refetches + 1
                : 0,
          };
        }
      : skipToken,
    staleTime: 60_000,
    retry: false,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (query.state.status === 'error' || data?.state !== 'unknown')
        return false;
      return data.refetches < MAX_UNKNOWN_REFETCHES
        ? UNKNOWN_REFETCH_INTERVAL
        : false;
    },
  });
}

export function usePrMergeabilityQuery(
  id: Accessor<string>,
  reference: Accessor<PrRef | undefined>
) {
  return useQuery(
    () => {
      const current = reference();
      const snapshot = current
        ? { owner: current.owner, repo: current.repo, number: current.number }
        : undefined;
      return prMergeabilityQueryOptions(id(), snapshot);
    },
    () => queryClient
  );
}
