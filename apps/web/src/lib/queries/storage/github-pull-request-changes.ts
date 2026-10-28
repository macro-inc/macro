/**
 * Queries for a GitHub pull request's changes at its current base and head.
 *
 * The server reads GitHub once per base and head and stores the result, so
 * the summary answers from storage after the first viewer. A changeset id
 * names one base and head, so its patch is cached for the life of the page.
 */

import { throwOnErr } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { githubPullRequestChangesKeys } from './keys';

const GITHUB_PULL_REQUEST_CHANGES_STALE_TIME = 60 * 1000;

/** The changes of the pull request behind a foreign entity record. */
export function useGithubPullRequestChangesQuery(
  foreignEntityId: Accessor<string | undefined>
) {
  return useQuery(() => {
    const id = foreignEntityId();
    return {
      queryKey: githubPullRequestChangesKeys.summary(id ?? '').queryKey,
      queryFn: () =>
        throwOnErr(() =>
          storageServiceClient.getGithubPullRequestChanges({ id: id! })
        ),
      enabled: Boolean(id),
      retry: false,
      staleTime: GITHUB_PULL_REQUEST_CHANGES_STALE_TIME,
    };
  });
}

/**
 * The unified diff behind one changeset of that pull request. `undefined`
 * disables the query.
 */
export function useGithubPullRequestChangesPatchQuery(
  foreignEntityId: Accessor<string | undefined>,
  changesetId: Accessor<string | undefined>
) {
  return useQuery(() => {
    const id = foreignEntityId();
    const changeset = changesetId();
    return {
      queryKey: githubPullRequestChangesKeys.patch(id ?? '', changeset ?? '')
        .queryKey,
      queryFn: () =>
        throwOnErr(() =>
          storageServiceClient.getGithubPullRequestChangesPatch({
            id: id!,
            changeset: changeset!,
          })
        ),
      enabled: Boolean(id) && Boolean(changeset),
      retry: 1,
      staleTime: Number.POSITIVE_INFINITY,
    };
  });
}
