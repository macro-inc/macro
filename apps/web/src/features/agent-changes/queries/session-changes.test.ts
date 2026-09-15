import { describe, expect, it } from 'vitest';
import { decodeSessionChanges } from './session-changes';

describe('decodeSessionChanges', () => {
  it('turns wire nulls into absent fields', () => {
    const decoded = decodeSessionChanges({
      capturing: false,
      attempt: {
        startedAt: 't0',
        finishedAt: null,
        outcome: null,
        error: null,
      },
      changeset: {
        id: 'cs',
        source: 'macrod_git',
        repository: null,
        base: { name: 'main', sha: null },
        head: { name: null, sha: 'abc' },
        files: [
          {
            path: 'a.ts',
            previousPath: null,
            kind: 'modified',
            additions: 1,
            deletions: 2,
            binary: false,
            patchOmitted: false,
          },
        ],
        additions: 1,
        deletions: 2,
        patchBytes: 10,
        truncated: false,
        capturedAt: 't1',
      },
    });
    expect(decoded.attempt).toEqual({ startedAt: 't0' });
    expect(decoded.changeset?.repository).toBeUndefined();
    expect(decoded.changeset?.base).toEqual({ name: 'main' });
    expect(decoded.changeset?.head).toEqual({ sha: 'abc' });
    expect(decoded.changeset?.files[0]).toEqual({
      path: 'a.ts',
      kind: 'modified',
      additions: 1,
      deletions: 2,
      binary: false,
      patchOmitted: false,
    });
  });
});
