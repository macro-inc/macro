/** Shared wire decoding and query status, without session query dependencies. */
import type {
  ChangedFileDto,
  ChangesetDto,
  GitRefDto,
} from '@service-agent-harness/generated/schemas';
import type { QueryStatus } from '../context/changes-context';
import type { ChangedFile, Changeset, GitRef } from '../core/changeset';

function decodeRef(ref: GitRefDto): GitRef {
  return { name: ref.name ?? undefined, sha: ref.sha ?? undefined };
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

export function queryStatus(query: {
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
