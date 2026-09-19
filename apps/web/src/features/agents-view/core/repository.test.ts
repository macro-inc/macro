import { describe, expect, it } from 'vitest';
import {
  defaultBranchFor,
  filterRepositories,
  orderRepositories,
  parseRepositoryInput,
  type ReachableRepository,
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

const macro: ReachableRepository = {
  url: 'https://github.com/macro-inc/macro',
  defaultBranch: 'main',
};
const infra: ReachableRepository = {
  url: 'https://github.com/macro-inc/infra',
  defaultBranch: 'develop',
};
const scratch: ReachableRepository = {
  url: 'https://github.com/macro-inc/scratch',
};

describe('orderRepositories', () => {
  it('puts recents first, in their order, then the rest as listed', () => {
    expect(orderRepositories([infra, macro, scratch], [scratch.url])).toEqual([
      scratch,
      infra,
      macro,
    ]);
  });

  it('omits a recent the listing no longer carries, and dedupes by spelling', () => {
    expect(
      orderRepositories(
        [macro],
        [
          'https://github.com/macro-inc/gone',
          'https://github.com/Macro-Inc/MACRO',
        ]
      )
    ).toEqual([macro]);
  });
});

describe('filterRepositories', () => {
  it('matches the owner/repo label and the url, ignoring case', () => {
    const all = [macro, infra, scratch];
    expect(filterRepositories(all, '')).toEqual(all);
    expect(filterRepositories(all, 'INFRA')).toEqual([infra]);
    expect(filterRepositories(all, 'macro-inc/s')).toEqual([scratch]);
    expect(filterRepositories(all, 'github.com/macro-inc/macro')).toEqual([
      macro,
    ]);
    expect(filterRepositories(all, 'nothing')).toEqual([]);
  });
});

describe('defaultBranchFor', () => {
  it("starts on the repository's default branch, or main without one", () => {
    const all = [macro, infra, scratch];
    expect(defaultBranchFor(all, infra.url)).toBe('develop');
    expect(defaultBranchFor(all, 'https://github.com/Macro-Inc/Infra')).toBe(
      'develop'
    );
    expect(defaultBranchFor(all, scratch.url)).toBe('main');
    expect(defaultBranchFor(all, 'https://github.com/macro-inc/unlisted')).toBe(
      'main'
    );
    expect(defaultBranchFor(all, undefined)).toBe('main');
  });
});
