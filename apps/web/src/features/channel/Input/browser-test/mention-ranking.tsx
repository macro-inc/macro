import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { DocumentMentionStatic } from '@core/component/LexicalMarkdown/component/decorator/DocumentMention';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import { filterQuickAccessItems } from '@core/context/quickAccess/entity-search';
import { contactUserItem } from '@core/context/quickAccess/person-items';
import type {
  Bucket,
  EntityItem,
  ItemForBucket,
  ItemsForBuckets,
  QuickAccessContextValue,
  QuickAccessList,
  QuickAccessListOptions,
} from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { DocumentMentionNode } from '@macro-inc/lexical-core';
import { setDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import { createContactDirectoryWindow } from '@queries/contacts/directory-query';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { ChannelInput } from '../ChannelInput';
import { makeInputValuePersistenceKey } from '../utils/persistence';

const CHANNEL_ID = 'mention-fixture-channel';
// Render the stored chip without a backend preview or app navigation host.
setDecorator(DocumentMentionNode, DocumentMentionStatic);
const CRM_SCENARIO = new URLSearchParams(location.search).has('crm');
const ITEMS: EntityItem[] = CRM_SCENARIO
  ? [
      {
        id: 'company',
        kind: 'entity',
        bucket: 'crm_company',
        searchText: 'Acme company',
        sortTimestamp: 0,
        timestamps: {},
        data: {
          type: 'crm_company',
          id: 'company',
          name: 'Acme company',
          teamId: 'team',
          hidden: false,
          ownerId: 'owner',
          domains: [],
        },
      },
    ]
  : [
      ...Array.from(
        { length: 500 },
        (_, index): EntityItem => ({
          id: `task-${index}`,
          kind: 'entity',
          bucket: 'task',
          searchText: `Track task changes ${index}`,
          sortTimestamp: Date.now(),
          timestamps: { viewedAt: new Date() },
          data: {
            type: 'document',
            id: `task-${index}`,
            name: `Track task changes ${index}`,
            ownerId: 'owner',
            fileType: 'md',
            subType: { type: 'task' },
          },
        })
      ),
      {
        id: 'project',
        kind: 'entity',
        bucket: 'initiative',
        searchText: 'Task planning',
        sortTimestamp: 0,
        timestamps: {},
        data: {
          type: 'initiative',
          id: 'project',
          name: 'Task planning',
          ownerId: 'owner',
        },
      },
    ];

const [peopleReads, setPeopleReads] = createSignal(0);
const [lastPeopleRead, setLastPeopleRead] = createSignal('');
function useList(): QuickAccessList;
function useList<B extends Bucket>(
  bucket: B
): QuickAccessList<ItemForBucket<B>>;
function useList<B extends Bucket[]>(
  ...buckets: B
): QuickAccessList<ItemsForBuckets<B>>;
function useList<const B extends readonly Bucket[]>(
  options: QuickAccessListOptions<B>
): QuickAccessList<ItemForBucket<B[number]>>;
function useList(
  ...args: (Bucket | QuickAccessListOptions)[]
): QuickAccessList {
  const first = args[0];
  const options = typeof first === 'object' ? first : undefined;
  const buckets =
    options?.buckets ??
    args.filter((bucket): bucket is Bucket => typeof bucket === 'string');
  const people = createContactDirectoryWindow(
    () => ({ userId: 'macro|viewer@example.com' }),
    async (viewer, _host, request) => {
      setPeopleReads((count) => count + 1);
      setLastPeopleRead(
        JSON.stringify({ query: request.query, cursor: request.cursor })
      );
      const start =
        request.query === 'late'
          ? 99_999
          : request.cursor?.source === 'server'
            ? Number(request.cursor.after)
            : 0;
      const ids =
        !request.query || ['directory', 'late'].includes(request.query)
          ? Array.from(
              { length: Math.min(50, 100_000 - start) },
              (_, i) => start + i
            )
          : [];
      return {
        source: 'server',
        sync: 'unavailable',
        offline: false,
        query: request.query,
        users: ids.map((i) => ({
          id: `macro|person${i}@example.com`,
          email: `person${i}@example.com`,
          name:
            i === 99_999
              ? 'Late person'
              : `Directory person ${String(i).padStart(6, '0')}`,
        })),
        nextCursor:
          ids.length && start + ids.length < 100_000
            ? {
                source: 'server',
                userId: viewer,
                query: request.query,
                after: String(start + ids.length),
              }
            : null,
      };
    },
    () =>
      (!buckets.length || buckets.includes('person')) &&
      options?.enabled?.() !== false,
    { search: options?.searchTerm }
  );
  const items = () => [
    ...filterQuickAccessItems(
      ITEMS.filter((item) => !buckets.length || buckets.includes(item.bucket)),
      options?.searchTerm?.() ?? ''
    ),
    ...(people.data()?.users ?? []).map(contactUserItem),
  ];
  return {
    items,
    totalCount: () => items().length,
    windowKey: people.windowKey,
    hasMore: () => !!people.data()?.nextCursor,
    isLoading: people.loading,
    isLoadingMore: people.loading,
    error: people.error,
    loadMore: async () => {
      await people.loadNext();
    },
  };
}
// Real bounded people windows, cached entity items and real menu ranking.
const QUICK_ACCESS: QuickAccessContextValue = {
  useList,
  usesRecordSelection: () => false,
  usesSearchProjection: () => true,
  isLoading: () => false,
  refresh: () => {},
  getById: (id) => ITEMS.find((item) => item.id === id),
  interactionForUser: () => undefined,
};

/** Real channel composer and mention menu over a controlled Quick Access source. */
function Fixture() {
  useHotKeyRoot();
  const [draft, setDraft] = createSignal('');
  const discussion = new URLSearchParams(location.search).has('discussion');
  const scoped = new URLSearchParams(location.search).has('scoped');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  return (
    <QueryClientProvider client={client}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <QuickAccessContextProvider value={QUICK_ACCESS}>
                    <main class="min-h-screen bg-page p-4 text-ink space-y-4 flex flex-col justify-end">
                      <h1>
                        {CRM_SCENARIO
                          ? 'CRM mentions'
                          : 'Project mention ranking'}
                      </h1>
                      <output data-testid="draft" hidden>
                        {draft()}
                      </output>
                      <output data-testid="people-reads">
                        {peopleReads()}
                      </output>
                      <output data-testid="last-people-read">
                        {lastPeopleRead()}
                      </output>
                      <ChannelInput
                        parent={
                          discussion
                            ? {
                                type: 'document',
                                id: '00000000-0000-4000-8000-000000000001',
                              }
                            : undefined
                        }
                        onChange={(snapshot) => {
                          setDraft(snapshot.value);
                        }}
                        input={{
                          mode: 'channel',
                          id: `channel-input-${CHANNEL_ID}`,
                          placeholder: 'Message #planning',
                        }}
                        participants={discussion && !scoped ? undefined : () => {
                          if (CRM_SCENARIO) return [{ id: 'macro|member@example.com', email: 'member@example.com', name: 'Acme member' }];
                          return [];
                        }}
                        bots={() => []}
                        persistenceKey={makeInputValuePersistenceKey({
                          channelId: `${CHANNEL_ID}-${discussion ? (scoped ? 'scoped' : 'directory') : 'channel'}`,
                        })}
                      />
                    </main>
                  </QuickAccessContextProvider>
                </ChannelsContextProvider>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
