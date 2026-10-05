import { changesState } from '@app/features/agent-changes/core/changeset';
import { describe, expect, it } from 'vitest';
import { decodePrChanges } from './pr-changes';

describe('decodePrChanges', () => {
  it('shows the changeset GitHub provided', () => {
    const decoded = decodePrChanges({
      changeset: {
        id: 'cs',
        source: 'github_pull_request',
        repository: 'https://github.com/o/r',
        base: { name: 'main', sha: 'aaa' },
        head: { name: 'work', sha: 'bbb' },
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
    expect(changesState(decoded).kind).toBe('ready');
    expect(decoded.changeset?.head).toEqual({ name: 'work', sha: 'bbb' });
  });

  it('shows why there are no changes', () => {
    const decoded = decodePrChanges(
      { error: 'This pull request is too large to load here.' },
      't0'
    );
    expect(changesState(decoded)).toEqual({
      kind: 'not_ready',
      message: 'This pull request is too large to load here.',
    });
  });
});
