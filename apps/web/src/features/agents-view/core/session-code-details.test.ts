import { describe, expect, it } from 'vitest';
import { repositoryLabel } from './session-code-details';

describe('repositoryLabel', () => {
  it.each([
    ['https://github.com/macro-inc/macro', 'macro-inc/macro'],
    ['https://github.com/macro-inc/macro.git/', 'macro-inc/macro'],
    ['git@github.com:macro-inc/macro.git', 'macro-inc/macro'],
    ['ssh://git@github.com/macro-inc/macro.git', 'macro-inc/macro'],
    [
      'https://token@github.com/macro-inc/macro.git?key=private',
      'macro-inc/macro',
    ],
    ['', undefined],
    ['not a repository URL', undefined],
    [null, undefined],
  ])('formats %s without credentials or transport details', (url, expected) => {
    expect(repositoryLabel(url)).toBe(expected);
  });
});
