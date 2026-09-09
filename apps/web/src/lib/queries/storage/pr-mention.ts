import { ThrownResultError, throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { pullRequestMentionKeys } from './keys';

const PR_MENTION_STALE_TIME = 60 * 1000;

type EnabledInput = boolean | Accessor<boolean>;

function readEnabled(enabled: EnabledInput | undefined): boolean {
  if (enabled === undefined) return true;
  return typeof enabled === 'function' ? enabled() : enabled;
}

function prMentionQueryOptions(id: string) {
  return {
    queryKey: pullRequestMentionKeys.foreignEntity(id).queryKey,
    queryFn: async (): Promise<ForeignEntity> =>
      await throwOnErr(() => storageServiceClient.getForeignEntity({ id })),
    staleTime: PR_MENTION_STALE_TIME,
    retry: 1,
  };
}

/**
 * Source name the GitHub webhook sync stores pull request mappings under.
 */
const GITHUB_PULL_REQUEST_SOURCE = 'github_pull_request';

/**
 * Resolve a pull request mention from its GitHub key (`owner/repo/pull/12`).
 *
 * A pull request that was just opened may not have been synced by the webhook
 * yet, so a `404` resolves to `undefined` data instead of an error and callers
 * can poll until the mapping appears.
 */
function pullRequestByGithubKeyQueryOptions(githubKey: string) {
  return {
    queryKey: pullRequestMentionKeys.byGithubKey(githubKey).queryKey,
    queryFn: async (): Promise<ForeignEntity | undefined> => {
      const result = await storageServiceClient.getForeignEntityBySource({
        source: GITHUB_PULL_REQUEST_SOURCE,
        foreignEntityId: githubKey,
      });

      if (result.isErr()) {
        if (result.error.some((error) => error.code === 'NOT_FOUND')) {
          return undefined;
        }

        throw new ThrownResultError(result.error);
      }

      return result.value;
    },
    staleTime: PR_MENTION_STALE_TIME,
    retry: 1,
  };
}

export function usePullRequestByGithubKeyQuery(
  githubKey: Accessor<string | undefined>,
  enabled?: EnabledInput
) {
  return useQuery(() => {
    const key = githubKey();

    return {
      ...pullRequestByGithubKeyQueryOptions(key ?? ''),
      enabled: !!key && readEnabled(enabled),
    };
  });
}

export function usePrMentionQuery(
  id: Accessor<string>,
  enabled?: EnabledInput
) {
  return useQuery(() => ({
    ...prMentionQueryOptions(id()),
    enabled: !!id() && readEnabled(enabled),
  }));
}
