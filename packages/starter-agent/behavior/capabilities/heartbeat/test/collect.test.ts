import { expect, test } from 'bun:test';
import {
  type RepositoryState,
  repositorySection,
  snapshot,
} from '../collect.ts';

const fine: RepositoryState = {
  conflict: undefined,
  misplaced: { local: [], stray: [] },
};

test('a repository with nothing wrong has no section', () => {
  expect(repositorySection(fine)).toBe('');
});

test("the repository's section: a conflict with the remote, and what git shouldn't be keeping", () => {
  expect(
    repositorySection({
      conflict: '0123456789abcdef',
      misplaced: { local: ['private/people/ada.md'], stray: ['notes.md'] },
    })
  ).toBe(
    [
      '## Your repository',
      "- Your commits on main conflict with the remote's main at 0123456789ab: pulling it with --rebase stopped, so it was aborted and nothing is pushed. Your owner has been told. Every commit tries again.",
      '- Tracked by git, in a bucket that is never committed: private/people/ada.md',
      '- Tracked by git, under the state directory but in no bucket: notes.md',
    ].join('\n')
  );
  const many = Array.from({ length: 23 }, (_, index) => `log/${index}`);
  expect(
    repositorySection({ ...fine, misplaced: { local: many, stray: [] } })
  ).toEndWith('log/19 and 3 more');
});

test("the snapshot is the repository and the other areas' sections, leaving out the empty ones", async () => {
  expect(
    await snapshot({
      repository: async () => fine,
      sections: async () => ['', '## Leftovers\n- a\n', '  '],
    })
  ).toBe('## Leftovers\n- a');
  expect(
    await snapshot({
      repository: async () => ({ ...fine, conflict: 'f'.repeat(40) }),
      sections: async () => ['## Leftovers\n- a'],
    })
  ).toStartWith('## Your repository\n- Your commits on main conflict');
  expect(
    await snapshot({ repository: async () => fine, sections: async () => [] })
  ).toBe('');
});
