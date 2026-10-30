import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { DocumentMentionStatic } from '@core/component/LexicalMarkdown/component/decorator/DocumentMention';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import { filterQuickAccessItems } from '@core/context/quickAccess/entity-search';
import type {
  Bucket,
  EntityItem,
  QuickAccessContextValue,
  QuickAccessListOptions,
} from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { DocumentMentionNode } from '@macro-inc/lexical-core';
import { setDecorator } from '@macro-inc/lexical-core/decoratorRegistry';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { ChannelInput } from '../ChannelInput';
import { makeInputValuePersistenceKey } from '../utils/persistence';

const CHANNEL_ID = 'mention-fixture-channel';
// Render the stored chip without a backend preview or app navigation host.
setDecorator(DocumentMentionNode, DocumentMentionStatic);
const ITEMS: EntityItem[] = [
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

// Reproduce the production merge: cached tasks first, the project appended.
// Query filtering stays source-owned; the real menu owns all ranking/selection.
const QUICK_ACCESS: QuickAccessContextValue = {
  useList: ((...args: Bucket[] | [QuickAccessListOptions]) => {
    const first = args[0];
    const options = typeof first === 'object' ? first : undefined;
    const buckets =
      options?.buckets ??
      args.filter((bucket): bucket is Bucket => typeof bucket === 'string');
    const items = () =>
      filterQuickAccessItems(
        ITEMS.filter(
          (item) => !buckets.length || buckets.includes(item.bucket)
        ),
        options?.searchTerm?.() ?? ''
      );
    return {
      items,
      totalCount: () => items().length,
      hasMore: () => false,
      isLoading: () => false,
      isLoadingMore: () => false,
      error: () => undefined,
      loadMore: async () => {},
    };
  }) as QuickAccessContextValue['useList'],
  usesRecordSelection: () => false,
  usesSearchProjection: () => true,
  isLoading: () => false,
  refresh: () => {},
  getById: (id) => ITEMS.find((item) => item.id === id),
};

/** Real channel composer and mention menu over a controlled Quick Access source. */
function Fixture() {
  useHotKeyRoot();
  const [draft, setDraft] = createSignal('');
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
                      <h1>Project mention ranking</h1>
                      <output data-testid="draft" hidden>
                        {draft()}
                      </output>
                      <ChannelInput
                        onChange={(snapshot) => {
                          setDraft(snapshot.value);
                        }}
                        input={{
                          mode: 'channel',
                          id: `channel-input-${CHANNEL_ID}`,
                          placeholder: 'Message #planning',
                        }}
                        participants={() => []}
                        bots={() => []}
                        persistenceKey={makeInputValuePersistenceKey({
                          channelId: CHANNEL_ID,
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
