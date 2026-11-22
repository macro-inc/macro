// Mutants planted in the branch's reader, one at a time, to show the
// harness catches each kind of fault. Each edits one file of the new
// worktree; `revertMutant` restores it from git.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Mutant = {
  name: string;
  what: string;
  file: string;
  find: string;
  replace: string;
};

export const MUTANTS: Mutant[] = [
  {
    name: 'drop-row',
    what: 'The GraphQL list drops its third row.',
    file: 'apps/web/src/lib/queries/soup/graphql/items.ts',
    find: 'visible().flatMap((item) => (item.entity ? [item.entity] : []))',
    replace: 'visible().flatMap((item) => (item.entity ? [item.entity] : [])).filter((_, i) => i !== 2)',
  },
  {
    name: 'swap-order',
    what: 'The GraphQL list swaps its first two rows.',
    file: 'apps/web/src/lib/queries/soup/graphql/items.ts',
    find: 'visible().flatMap((item) => (item.entity ? [item.entity] : []))',
    replace:
      '((list) => (list.length > 1 ? [list[1], list[0], ...list.slice(2)] : list))(visible().flatMap((item) => (item.entity ? [item.entity] : [])))',
  },
  {
    name: 'alter-field',
    what: "Rows carry their page's notification time one minute early.",
    file: 'apps/web/src/lib/queries/soup/graphql/items.ts',
    find: '({ record, fetched, notifiedAt, updatedAt }) => {',
    replace: '({ record, fetched, notifiedAt: listed, updatedAt }) => { const notifiedAt = listed && new Date(Date.parse(listed) - 60_000).toISOString();',
  },
  {
    name: 'stale-cache',
    what: 'An item two loaded pages list keeps the older notification time.',
    file: 'apps/web/src/lib/queries/soup/graphql/create-soup-live-query.ts',
    find: 'Date.parse(notifiedAt) > Date.parse(known)',
    replace: 'Date.parse(notifiedAt) < Date.parse(known)',
  },
  {
    name: 'skip-live',
    what: 'A pushed notification no longer re-reads GraphQL notified lists.',
    file: 'apps/web/src/lib/queries/notification/notification-soup.ts',
    find: '  revalidateNotifiedGraphqlSoupLists();\n\n  const soupTag',
    replace: '\n  const soupTag',
  },
];

export function applyMutant(worktree: string, mutant: Mutant) {
  const path = join(worktree, mutant.file);
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf(mutant.find);
  if (at < 0 || text.indexOf(mutant.find, at + 1) >= 0) {
    throw new Error(`mutant ${mutant.name}: expected exactly one match in ${mutant.file}`);
  }
  writeFileSync(path, text.replace(mutant.find, mutant.replace));
}

export function revertMutant(worktree: string, mutant: Mutant) {
  execFileSync('git', ['-C', worktree, 'checkout', '--', mutant.file]);
}
