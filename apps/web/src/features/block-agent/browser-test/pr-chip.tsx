import '@app/index.css';
import { queryClient } from '@queries/client';
import { pullRequestMentionKeys } from '@queries/storage/keys';
import type { ForeignEntity } from '@service-storage/generated/schemas';
import { QueryClientProvider } from '@tanstack/solid-query';
import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { AgentPullRequestChip } from '../component/AgentPullRequestChip';

// One row per state the header chip can be in. Each PR's GitHub lookup is
// answered from the cache before mount: `null` is a PR GitHub never synced
// (the lookup's 404), an entity is a synced PR with that status.
const ROWS: { label: string; number: number; status?: string | null }[] = [
  { label: 'Not synced', number: 11755, status: null },
  { label: 'Synced, open', number: 11756, status: 'open' },
  { label: 'Synced, merged', number: 11757, status: 'merged' },
  { label: 'Synced, closed', number: 11758, status: 'closed' },
  { label: 'Synced, no status', number: 11759 },
];

function seed(row: (typeof ROWS)[number]) {
  const key = `macro-inc/macro/pull/${row.number}`;
  const entity: ForeignEntity | null =
    row.status === null
      ? null
      : {
          id: `019f0000-0000-7000-8000-0000000${row.number}`,
          foreignEntityId: key,
          foreignEntitySource: 'github_pull_request',
          metadata: {
            ...(row.status ? { status: row.status } : {}),
            name: `Fixture PR ${row.number}`,
            number: row.number,
          },
          storedForId: 'fixture-user',
          storedForAuthEntity: 'user',
          createdAt: '2026-11-22T00:00:00Z',
          updatedAt: '2026-11-22T00:00:00Z',
        };
  queryClient.setQueryData(
    pullRequestMentionKeys.byGithubKey(key).queryKey,
    entity
  );
}

for (const row of ROWS) seed(row);

function Fixture() {
  return (
    <main class="flex min-h-screen flex-col gap-3 bg-page p-6 text-sm text-ink">
      <For each={ROWS}>
        {(row) => (
          <div class="flex items-center gap-4" data-row={row.label}>
            <span class="w-36 text-ink-muted">{row.label}</span>
            <AgentPullRequestChip
              url={`https://github.com/macro-inc/macro/pull/${row.number}`}
            />
          </div>
        )}
      </For>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Fixture />
    </QueryClientProvider>
  ),
  root
);
