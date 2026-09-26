import { ThrownResultError, throwOnErr } from '@core/util/result';
import { queryReadyGate } from '@queries/gate';
import { agentHarnessServiceClient } from '@service-agent-harness/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import {
  parseGithubPrUrl,
  prHtmlUrl,
  toGithubKey,
} from '../../block-pr/util/prKey';
import type { ChangesSource } from '../context/agent-changes-context';
import { agentChangesKeys } from './keys';
import { decodeChangeset, queryStatus } from './session-changes';

export function pullRequestChangesQueryOptions(
  url: string | undefined,
  enabled = true
) {
  const reference = url ? parseGithubPrUrl(url) : null;
  return {
    queryKey: agentChangesKeys.pullRequestChanges(
      reference ? toGithubKey(reference) : ''
    ).queryKey,
    enabled: enabled && reference !== null,
    queryFn: async () => {
      if (!reference) throw new Error('A GitHub pull request is required.');
      return throwOnErr(() =>
        agentHarnessServiceClient.getPullRequestChanges(prHtmlUrl(reference))
      );
    },
    staleTime: 30_000,
    retry: false,
  };
}

/** Read a PR directly; summary and patch always belong to the same snapshot. */
export function createPullRequestChangesSource(
  url: Accessor<string | undefined>,
  enabled: Accessor<boolean> = () => true
): ChangesSource {
  const query = useQuery(() =>
    pullRequestChangesQueryOptions(url(), enabled())
  );
  // Guard reads so this source never suspends the PR block's surrounding UI.
  const snapshot = () => (queryReadyGate(query) ? query.data : undefined);

  const refresh = async () => {
    if (!url()) return;
    await query.refetch({ throwOnError: true });
  };

  return {
    summary: () => {
      const current = snapshot();
      if (!current && !query.isError) return undefined;
      const failedAt = new Date(query.errorUpdatedAt).toISOString();
      return {
        changeset: current ? decodeChangeset(current.changeset) : undefined,
        capturing: false,
        attempt: query.isError
          ? {
              startedAt: failedAt,
              finishedAt: failedAt,
              outcome: 'failed' as const,
              error:
                query.error instanceof ThrownResultError
                  ? query.error.message
                  : 'The latest changes could not be loaded. Try refreshing.',
            }
          : undefined,
      };
    },
    summaryStatus: () => queryStatus(query),
    patch: (changesetId, patchEnabled) => ({
      text: () => {
        if (!patchEnabled()) return undefined;
        const current = snapshot();
        return current?.changeset.id === changesetId()
          ? current?.patch
          : undefined;
      },
      status: () =>
        !patchEnabled() ? 'idle' : snapshot() ? 'success' : queryStatus(query),
      retry: () => void query.refetch(),
    }),
    refresh,
  };
}
