import { describe, expect, it } from 'vitest';
import {
  harnessDisplayName,
  sessionRepositoryUrl,
} from './compose-agent-session-options';

describe('sessionRepositoryUrl', () => {
  const repoUrl = 'https://github.com/macro-inc/macro';

  it('shows the repository of a coding session', () => {
    expect(sessionRepositoryUrl({ harness: 'cursor', repoUrl })).toBe(repoUrl);
    expect(sessionRepositoryUrl({ harness: 'macrod', repoUrl })).toBe(repoUrl);
  });

  it('hides the default repository stamped on a chat session', () => {
    expect(sessionRepositoryUrl({ harness: 'in-memory', repoUrl })).toBe(
      undefined
    );
    expect(sessionRepositoryUrl({ harness: 'macro-inmem', repoUrl })).toBe(
      undefined
    );
  });

  it('is empty without a session or repository', () => {
    expect(sessionRepositoryUrl(undefined)).toBe(undefined);
    expect(sessionRepositoryUrl({ harness: 'cursor', repoUrl: null })).toBe(
      undefined
    );
  });
});

describe('harnessDisplayName', () => {
  it('names Macro runtimes after the product', () => {
    expect(harnessDisplayName('in-memory')).toBe('Macro');
    expect(harnessDisplayName('sandbox')).toBe('Macro');
  });

  it('names the Cursor runtime', () => {
    expect(harnessDisplayName('cursor')).toBe('Cursor');
  });

  it('leaves registered harness names alone', () => {
    expect(harnessDisplayName('my-laptop')).toBe('my-laptop');
  });
});
