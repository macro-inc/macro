/**
 * The vocabulary of a session's captured changes.
 *
 * Pure types and functions: what a changed file is, how a capture went, and
 * the small derivations the pane shows (status letters, totals, path
 * splitting). Wire decoding lives in `queries/`; rendering in `components/`.
 */

/** What happened to a file between the base and the head. */
export type FileChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

/** One changed file, as the summary reports it. */
export type ChangedFile = {
  /** The path after the change, or before it for a deletion. */
  path: string;
  /** Where a renamed file came from. */
  previousPath?: string;
  kind: FileChangeKind;
  additions: number;
  deletions: number;
  /** The diff carries no text for this file. */
  binary: boolean;
  /** The file's hunks were left out of the patch to fit the size budget. */
  patchOmitted: boolean;
};

/** A branch or commit on one side of the comparison. */
export type GitRef = {
  name?: string;
  sha?: string;
};

/** One capture of a session's changes. */
export type Changeset = {
  /** Changes with every capture, so it doubles as a cache key for the patch. */
  id: string;
  /** `https://github.com/owner/name`, when known. */
  repository?: string;
  base: GitRef;
  head: GitRef;
  files: ChangedFile[];
  additions: number;
  deletions: number;
  /** Zero when nothing changed. */
  patchBytes: number;
  /** Some files' hunks were left out of the patch. */
  truncated: boolean;
  capturedAt: string;
};

/** How the latest capture attempt ended. */
export type CaptureOutcome = 'captured' | 'not_ready' | 'failed';

/** The latest capture attempt, running or finished. */
export type CaptureAttempt = {
  startedAt: string;
  finishedAt?: string;
  outcome?: CaptureOutcome;
  /** Why it did not capture, in a sentence the user can read. */
  error?: string;
};

/** Everything the summary endpoint says about a session's changes. */
export type SessionChanges = {
  changeset?: Changeset;
  attempt?: CaptureAttempt;
  /** A capture is running right now. */
  capturing: boolean;
};

/** The one-letter status the tree and file headers show. */
export type StatusLetter = 'A' | 'M' | 'D' | 'R';

export function statusLetter(kind: FileChangeKind): StatusLetter {
  switch (kind) {
    case 'added':
      return 'A';
    case 'modified':
      return 'M';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
  }
}

/** A path split into the directory prefix (with trailing slash) and basename. */
export function splitPath(path: string): { dir: string; base: string } {
  const at = path.lastIndexOf('/');
  if (at < 0) return { dir: '', base: path };
  return { dir: path.slice(0, at + 1), base: path.slice(at + 1) };
}

/** `owner/name` from a `https://github.com/owner/name` url, when it is one. */
export function repositorySlug(
  repository: string | undefined
): string | undefined {
  if (!repository) return undefined;
  const match = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/i.exec(repository);
  if (!match) return undefined;
  return `${match[1]}/${match[2]!.replace(/\.git$/, '')}`;
}

/** `head → base`, or whichever side is known, for the branch pill. */
export function describeRange(changeset: Changeset): string | undefined {
  const head = changeset.head.name ?? shortSha(changeset.head.sha);
  const base = changeset.base.name ?? shortSha(changeset.base.sha);
  if (head && base) return `${head} → ${base}`;
  return head ?? base;
}

function shortSha(sha: string | undefined): string | undefined {
  return sha ? sha.slice(0, 7) : undefined;
}

/** "6 files", "1 file". */
export function describeFileCount(count: number): string {
  return `${count} ${count === 1 ? 'file' : 'files'}`;
}

/**
 * Which state the pane is in, from the summary. A capture that is running
 * shows over a stale changeset; a failed one keeps the last good changeset
 * on screen with a notice.
 */
export type ChangesState =
  | { kind: 'loading' }
  /** The summary could not be read at all; nothing is known. */
  | { kind: 'load_error' }
  | { kind: 'capturing'; previous: Changeset | undefined }
  | { kind: 'ready'; changeset: Changeset }
  | { kind: 'empty'; changeset: Changeset }
  | { kind: 'not_ready'; message: string }
  | { kind: 'failed'; message: string; previous: Changeset | undefined }
  | { kind: 'none' };

export function changesState(
  summary: SessionChanges | undefined,
  summaryStatus: 'idle' | 'pending' | 'error' | 'success' = summary
    ? 'success'
    : 'pending'
): ChangesState {
  if (!summary) {
    return summaryStatus === 'error'
      ? { kind: 'load_error' }
      : { kind: 'loading' };
  }
  if (summary.capturing) {
    return { kind: 'capturing', previous: summary.changeset };
  }
  const { changeset, attempt } = summary;
  if (changeset) {
    if (attempt?.outcome === 'failed') {
      return {
        kind: 'failed',
        message: attempt.error ?? 'The last capture failed.',
        previous: changeset,
      };
    }
    return changeset.files.length > 0
      ? { kind: 'ready', changeset }
      : { kind: 'empty', changeset };
  }
  switch (attempt?.outcome) {
    case 'not_ready':
      return {
        kind: 'not_ready',
        message:
          attempt.error ??
          'Link a GitHub pull request to this session to review its changes.',
      };
    case 'failed':
      return {
        kind: 'failed',
        message: attempt.error ?? 'The last capture failed.',
        previous: undefined,
      };
    case 'captured':
    case undefined:
      return { kind: 'none' };
  }
}
