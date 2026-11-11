import { expect, test } from 'bun:test';
import {
  type RepositoryState,
  repositorySection,
  snapshot,
} from '../collect.ts';

const fine: RepositoryState = {
  alarm: undefined,
  misplaced: { local: [], stray: [] },
};

test('a repository with nothing wrong has no section', () => {
  expect(repositorySection(fine)).toBe('');
});

test("the repository's section: the alarm, and what git shouldn't be keeping", () => {
  expect(
    repositorySection({
      alarm: '0123456789abcdef',
      misplaced: { local: ['private/people/ada.md'], stray: ['notes.md'] },
    })
  ).toBe(
    [
      '## Your repository',
      "- The remote's main moved without you, to 0123456789ab. Your owner has been told. Nothing is pushed until the remote is back at what you last pushed.",
      '- Tracked by git, in a bucket that is never committed: private/people/ada.md',
      '- Tracked by git, under the state directory but in no bucket: notes.md',
    ].join('\n')
  );
  expect(repositorySection({ ...fine, alarm: 'unknown' })).toContain(
    "A push to the remote's main was rejected"
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
      repository: async () => ({ ...fine, alarm: 'unknown' }),
      sections: async () => ['## Leftovers\n- a'],
    })
  ).toStartWith('## Your repository\n- A push');
  expect(
    await snapshot({ repository: async () => fine, sections: async () => [] })
  ).toBe('');
});
