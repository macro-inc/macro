import { describe, expect, it } from 'vitest';
import {
  type Changeset,
  changesState,
  describeRange,
  repositorySlug,
  splitPath,
  statusLetter,
} from './changeset';

function changeset(overrides: Partial<Changeset> = {}): Changeset {
  return {
    id: 'cs-1',
    repository: 'https://github.com/macro-inc/macro',
    base: { name: 'main' },
    head: { name: 'agent/unread-archived-sessions' },
    files: [
      {
        path: 'a.ts',
        kind: 'modified',
        additions: 3,
        deletions: 1,
        binary: false,
        patchOmitted: false,
      },
    ],
    additions: 3,
    deletions: 1,
    patchBytes: 120,
    truncated: false,
    capturedAt: '2026-09-15T00:00:00Z',
    ...overrides,
  };
}

describe('statusLetter', () => {
  it('maps every kind to its letter', () => {
    expect(statusLetter('added')).toBe('A');
    expect(statusLetter('modified')).toBe('M');
    expect(statusLetter('deleted')).toBe('D');
    expect(statusLetter('renamed')).toBe('R');
  });
});

describe('splitPath', () => {
  it('keeps the trailing slash on the directory', () => {
    expect(splitPath('apps/web/src/a.ts')).toEqual({
      dir: 'apps/web/src/',
      base: 'a.ts',
    });
  });

  it('treats a bare name as having no directory', () => {
    expect(splitPath('README.md')).toEqual({ dir: '', base: 'README.md' });
  });
});

describe('repositorySlug', () => {
  it('reads owner/name from a GitHub url', () => {
    expect(repositorySlug('https://github.com/macro-inc/macro')).toBe(
      'macro-inc/macro'
    );
    expect(repositorySlug('https://github.com/macro-inc/macro.git')).toBe(
      'macro-inc/macro'
    );
  });

  it('is undefined for anything else', () => {
    expect(repositorySlug(undefined)).toBeUndefined();
    expect(repositorySlug('https://example.com/x/y')).toBeUndefined();
  });
});

describe('describeRange', () => {
  it('reads head → base', () => {
    expect(describeRange(changeset())).toBe(
      'agent/unread-archived-sessions → main'
    );
  });

  it('falls back to short shas and to one side', () => {
    expect(
      describeRange(
        changeset({ base: { sha: 'abcdef1234567' }, head: { name: 'x' } })
      )
    ).toBe('x → abcdef1');
    expect(describeRange(changeset({ base: {} }))).toBe(
      'agent/unread-archived-sessions'
    );
  });
});

describe('changesState', () => {
  it('is loading without a summary, and failed when the read errored', () => {
    expect(changesState(undefined)).toEqual({ kind: 'loading' });
    expect(changesState(undefined, 'pending')).toEqual({ kind: 'loading' });
    expect(changesState(undefined, 'error')).toEqual({ kind: 'load_error' });
  });

  it('shows a running capture over the previous changeset', () => {
    const previous = changeset();
    expect(changesState({ changeset: previous, capturing: true })).toEqual({
      kind: 'capturing',
      previous,
    });
  });

  it('is ready with files and empty without', () => {
    expect(
      changesState({ changeset: changeset(), capturing: false }).kind
    ).toBe('ready');
    expect(
      changesState({ changeset: changeset({ files: [] }), capturing: false })
        .kind
    ).toBe('empty');
  });

  it('keeps the last changeset when a later capture fails', () => {
    const previous = changeset();
    expect(
      changesState({
        changeset: previous,
        attempt: {
          startedAt: 't',
          finishedAt: 't',
          outcome: 'failed',
          error: 'GitHub said no',
        },
        capturing: false,
      })
    ).toEqual({ kind: 'failed', message: 'GitHub said no', previous });
  });

  it('names not-ready outcomes', () => {
    expect(
      changesState({
        attempt: { startedAt: 't', outcome: 'not_ready', error: 'No push yet' },
        capturing: false,
      })
    ).toEqual({ kind: 'not_ready', message: 'No push yet' });
  });

  it('has nothing to say before the first attempt', () => {
    expect(changesState({ capturing: false })).toEqual({ kind: 'none' });
  });
});
