import '@app/index.css';
import { PEOPLE_POLICY_VERSION } from '@graphql-cache/people/generated';
import { unsupportedContactSync } from '@graphql-cache/people/test-support';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { readContactDirectory } from '@queries/contacts/directory';
import {
  type ContactWindowHost,
  createContactDirectoryWindow,
} from '@queries/contacts/directory-query';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createMemo, createSignal, Match, Switch } from 'solid-js';
import { render } from 'solid-js/web';
import { ContactDirectoryInspector } from '../ContactDirectoryInspector';
import { CalendarFilterFixture } from './calendar-fixture';
import { CalendarGuestsFixture } from './calendar-guests-fixture';
import { ChannelRecipientFixture } from './channel-recipient-fixture';
import { ContactRemovalFixture } from './contact-removal-fixture';
import { LinearImportFixture } from './linear-import-fixture';
import {
  DriveListFilterFixture,
  NotesListFilterFixture,
} from './list-filter-fixture';
import { NameCacheFixture } from './name-cache-fixture';
import { changeViewer } from './network';
import { OnboardingContactsFixture } from './onboarding-contacts-fixture';
import { RecipientDirectoryFixture } from './recipient-directory-fixture';
import { RecipientRankingFixture } from './recipient-ranking-fixture';
import { SoupFilterFixture } from './soup-filter-fixture';
import { SqlPeopleFixture } from './sql-people-fixture';
import { TaskFilterFixture } from './task-filter-fixture';
import { TaskListLabelFixture } from './task-list-label-fixture';

const client = new QueryClient();
function App() {
  const [viewer, setViewer] = createSignal('account-a');
  const [offline, setOffline] = createSignal(false);
  const [cacheCount, setCacheCount] = createSignal(0);
  client
    .getQueryCache()
    .subscribe(() => setCacheCount(client.getQueryCache().getAll().length));
  const generation = '00000000-0000-4000-8000-000000000001';
  const complete = () =>
    localStorage.setItem(
      `graphql-contacts-backfill:v2:${viewer()}`,
      JSON.stringify({
        userId: viewer(),
        storageGeneration: generation,
        nextCursor: null,
        pages: 200,
        phase: 'verify',
        verificationIncomplete: false,
        completedAt: Date.now(),
      })
    );
  complete();
  const cache: ContactWindowHost = {
    clientId: 'fixture',
    currentStorageGeneration: async () => generation,
    readQuery: async () => ({ kind: 'hit', data: { user: { id: viewer() } } }),
    people: {
      ...unsupportedContactSync,
      readSql: async () => ({ kind: 'unsupported' }),
      resolveReferences: async () => ({ kind: 'unsupported' }),
      context: async () => ({ kind: 'unsupported' }),
      update: async () => {
        throw new Error('Fixture has no publisher');
      },
      search: async (request) => {
        const start = request.cursor ? Number(request.cursor) : 0;
        const ids = request.query
          ? request.query.toLowerCase().includes('rare')
            ? [99_999]
            : []
          : Array.from(
              { length: Math.min(request.limit, 100_000 - start) },
              (_, i) => start + i
            );
        return {
          kind: 'page',
          policyVersion: PEOPLE_POLICY_VERSION,
          people: ids.map((id) => ({
            recordKey: `GraphqlContact:${id}`,
            userId: `macro|${viewer()}-${id}@example.com`,
            email: `${viewer()}-${id}@example.com`,
            name: id === 99999 ? 'Rare person' : `Person ${id}`,
            matchRank: 0,
            score: 0,
            timestampMs: 0,
            directMessage: null,
            lastInteractionMs: null,
          })),
          truncated: !request.query && start + ids.length < 100_000,
          nextCursor:
            !request.query && start + ids.length < 100_000
              ? String(start + ids.length)
              : null,
        };
      },
    },
    readRecordsByKeys: async ({ keys }) => ({
      revision: INITIAL_CACHE_REVISION,
      records: keys.map((recordKey) => {
        const id = recordKey.split(':').at(-1);
        return {
          recordKey,
          record: {
            id: `scoped-${id}`,
            userId: `macro|${viewer()}-${id}@example.com`,
            email: `${viewer()}-${id}@example.com`,
            name: id === '99999' ? 'Rare person' : `Person ${id}`,
          },
        };
      }),
    }),
    onCacheChanged: () => () => {},
    onCacheGenerationChanged: () => () => {},
  };
  const directory = createContactDirectoryWindow(
    createMemo(() => ({ userId: viewer(), host: cache })),
    (user, host, request, signal) =>
      readContactDirectory(user, host, request, signal, !offline())
  );
  const switchAccount = () => {
    changeViewer('account-b');
    setViewer('account-b');
    complete();
  };
  return (
    <main class="p-4 max-w-xl mx-auto text-ink bg-page min-h-screen">
      <div class="flex flex-wrap gap-3 mb-4">
        <button onClick={switchAccount}>Switch account</button>
        <button
          onClick={() => {
            localStorage.removeItem(`graphql-contacts-backfill:v2:${viewer()}`);
            directory.restart();
          }}
        >
          Partial cache
        </button>
        <button
          onClick={() => {
            localStorage.removeItem(`graphql-contacts-backfill:v2:${viewer()}`);
            setOffline(true);
            directory.setSearch('rare');
          }}
        >
          Offline partial
        </button>
      </div>
      <ContactDirectoryInspector directory={directory} />
      <div data-testid="query-count">{cacheCount()}</div>
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <QueryClientProvider client={client}>
      <Switch fallback={<App />}>
        <Match
          when={new URLSearchParams(location.search).has('contact-removal')}
        >
          <ContactRemovalFixture />
        </Match>
        <Match when={new URLSearchParams(location.search).has('name-cache')}>
          <NameCacheFixture />
        </Match>
        <Match when={new URLSearchParams(location.search).has('sql-people')}>
          <SqlPeopleFixture />
        </Match>
        <Match when={new URLSearchParams(location.search).has('linear-import')}>
          <LinearImportFixture />
        </Match>
        <Match
          when={new URLSearchParams(location.search).has('onboarding-contacts')}
        >
          <OnboardingContactsFixture />
        </Match>
        <Match
          when={new URLSearchParams(location.search).has('task-list-labels')}
        >
          <TaskListLabelFixture />
        </Match>
        <Match when={new URLSearchParams(location.search).has('task-filters')}>
          <TaskFilterFixture />
        </Match>
        <Match
          when={new URLSearchParams(location.search).has('calendar-guests')}
        >
          <CalendarGuestsFixture />
        </Match>
        <Match
          when={new URLSearchParams(location.search).has('channel-recipients')}
        >
          <ChannelRecipientFixture />
        </Match>
        <Match when={new URLSearchParams(location.search).has('soup-filters')}>
          <SoupFilterFixture />
        </Match>
        <Match
          when={new URLSearchParams(location.search).has('recipient-directory')}
        >
          <RecipientDirectoryFixture />
        </Match>
        <Match
          when={new URLSearchParams(location.search).has('recipient-ranking')}
        >
          <RecipientRankingFixture />
        </Match>
        <Match
          when={
            new URLSearchParams(location.search).get('list-filters') === 'drive'
          }
        >
          <DriveListFilterFixture />
        </Match>
        <Match
          when={
            new URLSearchParams(location.search).get('list-filters') === 'notes'
          }
        >
          <NotesListFilterFixture />
        </Match>
        <Match when={new URLSearchParams(location.search).has('filters')}>
          <CalendarFilterFixture />
        </Match>
      </Switch>
    </QueryClientProvider>
  ),
  root
);
