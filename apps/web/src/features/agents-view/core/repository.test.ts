import { describe, expect, it } from 'vitest';
import {
  parseRepositoryInput,
  repositoryLabel,
  repositoryShortName,
} from './repository';

describe('parseRepositoryInput', () => {
  it('canonicalizes every way of naming a GitHub repository', () => {
    const expected = 'https://github.com/macro-inc/macro';
    expect(parseRepositoryInput('macro-inc/macro')).toBe(expected);
    expect(parseRepositoryInput(' github.com/macro-inc/macro ')).toBe(expected);
    expect(parseRepositoryInput('https://github.com/macro-inc/macro.git')).toBe(
      expected
    );
    expect(parseRepositoryInput('https://github.com/macro-inc/macro/')).toBe(
      expected
    );
    expect(
      parseRepositoryInput('https://github.com/macro-inc/macro/pull/12')
    ).toBe(expected);
    expect(parseRepositoryInput('git@github.com:macro-inc/macro.git')).toBe(
      expected
    );
  });

  it('keeps other hosts as typed, minus the .git suffix', () => {
    expect(parseRepositoryInput('https://gitlab.com/group/project.git')).toBe(
      'https://gitlab.com/group/project'
    );
  });

  it('rejects text that is not a repository', () => {
    expect(parseRepositoryInput('')).toBeUndefined();
    expect(parseRepositoryInput('macro')).toBeUndefined();
    expect(parseRepositoryInput('https://example.com')).toBeUndefined();
    expect(parseRepositoryInput('not a repo')).toBeUndefined();
  });
});

describe('repository names', () => {
  it('shows owner/repo and the bare name', () => {
    expect(repositoryLabel('https://github.com/macro-inc/macro')).toBe(
      'macro-inc/macro'
    );
    expect(repositoryShortName('https://github.com/macro-inc/macro')).toBe(
      'macro'
    );
    expect(repositoryLabel('https://gitlab.com/group/project.git')).toBe(
      'group/project'
    );
  });
});
