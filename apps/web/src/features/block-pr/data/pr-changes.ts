/**
 * Adapts the pull request changes queries to the Changes pane's
 * `ChangesSource`: wire DTOs become core types here, and a reason GitHub
 * gave no changes becomes a not-ready attempt the pane explains.
 */

import type {
  ChangesSource,
  PatchRead,
} from '@app/features/agent-changes/context/agent-changes-context';
import type { SessionChanges } from '@app/features/agent-changes/core/changeset';
import {
  decodeChangeset,
  queryStatus,
} from '@app/features/agent-changes/queries/session-changes';
import {
  useGithubPullRequestChangesPatchQuery,
  useGithubPullRequestChangesQuery,
} from '@queries/storage/github-pull-request-changes';
import type { GithubPullRequestChangesResponse } from '@service-storage/generated/schemas/githubPullRequestChangesResponse';
import type { Accessor } from 'solid-js';

export function decodePrChanges(
  dto: GithubPullRequestChangesResponse,
  now = new Date().toISOString()
): SessionChanges {
  if (dto.changeset) {
    return { changeset: decodeChangeset(dto.changeset), capturing: false };
  }
  return {
    attempt: {
      startedAt: now,
      finishedAt: now,
      outcome: 'not_ready',
      error: dto.error ?? undefined,
    },
    capturing: false,
  };
}

/** The changes of the pull request behind the foreign entity record `id`. */
export function createPrChangesSource(
  foreignEntityId: Accessor<string | undefined>
): ChangesSource {
  const summaryQuery = useGithubPullRequestChangesQuery(foreignEntityId);

  // Gate every `data` read on status: an unguarded read suspends the
  // nearest boundary (apps/web/AGENTS.md).
  const summary = () =>
    summaryQuery.isSuccess ? decodePrChanges(summaryQuery.data) : undefined;

  const patch = (
    changesetId: Accessor<string | undefined>,
    enabled: Accessor<boolean>
  ): PatchRead => {
    const query = useGithubPullRequestChangesPatchQuery(foreignEntityId, () =>
      enabled() ? changesetId() : undefined
    );
    return {
      text: () => (query.isSuccess ? query.data.patch : undefined),
      status: () => queryStatus(query),
      retry: () => void query.refetch(),
    };
  };

  return {
    summary,
    summaryStatus: () => queryStatus(summaryQuery),
    patch,
    refresh: async () => {
      await summaryQuery.refetch();
    },
  };
}
