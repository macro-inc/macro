/**
 * Adapts the agent-harness changes queries to the pane's `ChangesSource`:
 * wire DTOs become core types here, and TanStack status becomes the small
 * status vocabulary the primitives read.
 */

import {
  useAgentSessionChangesPatchQuery,
  useAgentSessionChangesQuery,
  useRefreshAgentSessionChangesMutation,
} from '@queries/agent-session/changes';
import type {
  AgentSessionChangesResponse,
  CaptureAttemptDto,
} from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';
import type { ChangesSource, PatchRead } from '../context/changes-context';
import type { CaptureAttempt, ChangesSummary } from '../core/changeset';
import { decodeChangeset, queryStatus } from './changes-adapter';

function decodeAttempt(dto: CaptureAttemptDto): CaptureAttempt {
  return {
    startedAt: dto.startedAt,
    finishedAt: dto.finishedAt ?? undefined,
    outcome: dto.outcome ?? undefined,
    error: dto.error ?? undefined,
  };
}

export function decodeSessionChanges(
  dto: AgentSessionChangesResponse
): ChangesSummary {
  return {
    changeset: dto.changeset ? decodeChangeset(dto.changeset) : undefined,
    attempt: dto.attempt ? decodeAttempt(dto.attempt) : undefined,
    capturing: dto.capturing,
  };
}

/** The production source: TanStack queries against the agent-harness service. */
export function createSessionChangesSource(
  sessionId: Accessor<string | undefined>
): ChangesSource {
  const summaryQuery = useAgentSessionChangesQuery(sessionId);
  const refresh = useRefreshAgentSessionChangesMutation();

  // Gate every `data` read on status: an unguarded read suspends the
  // nearest boundary (apps/web/AGENTS.md).
  const summary = () =>
    summaryQuery.isSuccess
      ? decodeSessionChanges(summaryQuery.data)
      : undefined;

  const patch = (
    changesetId: Accessor<string | undefined>,
    enabled: Accessor<boolean>
  ): PatchRead => {
    const query = useAgentSessionChangesPatchQuery(sessionId, () =>
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
      const id = sessionId();
      if (!id) return;
      await refresh.mutateAsync(id);
    },
  };
}
