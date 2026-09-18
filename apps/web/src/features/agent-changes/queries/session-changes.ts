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
  ChangedFileDto,
  ChangesetDto,
  GitRefDto,
} from '@service-agent-harness/generated/schemas';
import type { Accessor } from 'solid-js';
import type {
  ChangesSource,
  PatchRead,
  QueryStatus,
} from '../context/agent-changes-context';
import type {
  CaptureAttempt,
  ChangedFile,
  Changeset,
  GitRef,
  SessionChanges,
} from '../core/changeset';

function decodeRef(ref: GitRefDto): GitRef {
  return {
    name: ref.name ?? undefined,
    sha: ref.sha ?? undefined,
  };
}

function decodeFile(file: ChangedFileDto): ChangedFile {
  return {
    path: file.path,
    previousPath: file.previousPath ?? undefined,
    kind: file.kind,
    additions: file.additions,
    deletions: file.deletions,
    binary: file.binary,
    patchOmitted: file.patchOmitted,
  };
}

export function decodeChangeset(dto: ChangesetDto): Changeset {
  return {
    id: dto.id,
    repository: dto.repository ?? undefined,
    base: decodeRef(dto.base),
    head: decodeRef(dto.head),
    files: dto.files.map(decodeFile),
    additions: dto.additions,
    deletions: dto.deletions,
    patchBytes: dto.patchBytes,
    truncated: dto.truncated,
    capturedAt: dto.capturedAt,
  };
}

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
): SessionChanges {
  return {
    changeset: dto.changeset ? decodeChangeset(dto.changeset) : undefined,
    attempt: dto.attempt ? decodeAttempt(dto.attempt) : undefined,
    capturing: dto.capturing,
  };
}

function queryStatus(query: {
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  fetchStatus: string;
}): QueryStatus {
  if (query.isSuccess) return 'success';
  if (query.isError) return 'error';
  if (query.isPending && query.fetchStatus === 'idle') return 'idle';
  return 'pending';
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
