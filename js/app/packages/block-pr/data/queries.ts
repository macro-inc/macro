import type { GithubPullRequestEntity } from '@entity';
import { queryClient } from '@queries/client';
import { authServiceClient } from '@service-auth/client';
import type { EnrichedGithubPullRequest } from '@service-auth/generated/schemas';
import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

import type { PrRef } from '../util/prKey';
import { prDisplayName, prHtmlUrl, toGithubKey } from '../util/prKey';

const PR_STALE_TIME = 60 * 1000;

function prEnrichmentQueryKey(ref: PrRef): (string | number)[] {
  return ['github-pr', ref.owner, ref.repo, ref.number, 'enrichment'];
}

/**
 * Seed the PR block's query cache from a soup/entity-list
 * `GithubPullRequestEntity` — its metadata is the same stored, team-visible
 * data the block renders, so clicking through shows it immediately without
 * requiring a personal GitHub link.
 */
export function seedPrBlockData(entity: GithubPullRequestEntity): PrRef {
  const { owner, repo, number } = entity.metadata;
  const ref: PrRef = { owner, repo, number };
  // Synthetic entities (e.g. the pasted-URL command item) carry placeholder
  // metadata and no backing row — don't seed those, let the block fetch.
  if (!entity.storedForId) return ref;
  queryClient.setQueryData<GithubPullRequest>(prEnrichmentQueryKey(ref), {
    additions: entity.metadata.additions,
    checks: entity.metadata.checks,
    comments: entity.metadata.comments,
    deletions: entity.metadata.deletions,
    displayName: prDisplayName(ref),
    githubKey: toGithubKey(ref),
    name: entity.metadata.name,
    number,
    owner,
    repo,
    status: entity.metadata.status,
    url: entity.metadata.url,
  });
  return ref;
}

/** Enrichment failure carrying the service error codes for UI branching. */
export class PrEnrichmentError extends Error {
  constructor(public readonly codes: string[]) {
    super(`Failed to enrich pull request: ${codes.join(', ')}`);
    this.name = 'PrEnrichmentError';
  }
}

export function isGithubLinkError(error: unknown): boolean {
  return (
    error instanceof PrEnrichmentError &&
    (error.codes.includes('REAUTHENTICATION_REQUIRED') ||
      error.codes.includes('NOT_FOUND'))
  );
}

function toStorageShape(
  pullRequest: EnrichedGithubPullRequest
): GithubPullRequest {
  return {
    additions: pullRequest.additions,
    checks: pullRequest.checks,
    comments: pullRequest.comments,
    deletions: pullRequest.deletions,
    displayName: pullRequest.displayName,
    githubKey: pullRequest.githubKey,
    name: pullRequest.name,
    number: pullRequest.number,
    owner: pullRequest.owner,
    repo: pullRequest.repo,
    status: pullRequest.status,
    url: pullRequest.url,
  };
}

/**
 * Live enrichment via the user's personal GitHub link
 * (`POST /github_pull_requests/enrich`). Used as a fallback when the block
 * wasn't opened from a task — opening from a task uses the task's stored,
 * team-visible GitHub data instead and doesn't need this.
 */
export function usePrEnrichmentQuery(
  ref: Accessor<PrRef>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => {
    const current = ref();
    return {
      queryKey: prEnrichmentQueryKey(current),
      queryFn: async (): Promise<GithubPullRequest> => {
        const response = await authServiceClient.enrichGithubPullRequests({
          pullRequests: [
            {
              githubKey: toGithubKey(current),
              owner: current.owner,
              repo: current.repo,
              number: current.number,
              url: prHtmlUrl(current),
              displayName: prDisplayName(current),
            },
          ],
        });
        if (response.isErr()) {
          throw new PrEnrichmentError(
            response.error.map((error) => String(error.code))
          );
        }
        const pullRequest = response.value.pullRequests[0];
        if (!pullRequest) {
          throw new PrEnrichmentError(['NOT_FOUND']);
        }
        return toStorageShape(pullRequest);
      },
      staleTime: PR_STALE_TIME,
      enabled: enabled(),
      retry: (failureCount: number, error: unknown) =>
        !(error instanceof PrEnrichmentError) && failureCount < 2,
    };
  });
}
