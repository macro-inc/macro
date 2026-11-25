import '@app/index.css';
import { TagSetsProvider } from '@app/features/property/tags/tag-sets-context';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelDirectoryProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { EntityProvider } from '@entity';
import { staticChannelDirectory } from '@queries/channel/directory';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { ListEntity, ListLayoutProvider } from '../composed/ListEntity';
import { SearchContentHitRow } from '../extractors-search/search-content-hit-row';
import type { ChannelMessageEntity, DocumentEntity } from '../types/entity';
import type { ContentHitData, WithSearch } from '../types/search';

const SENT_AT = '2026-11-01T10:00:00Z';

/** A message found by a word inside the link it shares: the highlight splits
 * the URL, so markdown would link only the part before it. */
const message: WithSearch<ChannelMessageEntity> = {
  id: 'channel-1',
  type: 'channel_message',
  name: 'Design review',
  ownerId: 'macro|viewer@example.com',
  channelId: 'channel-1',
  channelName: 'Design review',
  channelType: 'private',
  messageId: 'message-1',
  senderId: 'macro|sender@example.com',
  content: 'https://app.sketchpad.example/file/0ABC',
  updatedAt: SENT_AT,
  search: {
    nameHighlight: null,
    senderHighlightTerms: null,
    source: 'service',
    contentHitData: [
      {
        type: 'channel',
        id: 'message-1',
        content: 'https://app.<macro_em>sketchpad</macro_em>.example/file/0ABC',
        senderId: 'macro|sender@example.com',
        sentAt: SENT_AT,
        location: { type: 'channel', messageId: 'message-1' },
      },
    ],
  },
};

/** A document found by a word inside the link its name holds. */
const documentResult: WithSearch<DocumentEntity> = {
  id: 'document-1',
  type: 'document',
  name: 'Roadmap https://app.planbook.example/roadmap',
  ownerId: 'macro|viewer@example.com',
  fileType: 'md',
  updatedAt: SENT_AT,
  search: {
    nameHighlight:
      'Roadmap https://app.<macro_em>planbook</macro_em>.example/roadmap',
    senderHighlightTerms: null,
    source: 'service',
    contentHitData: null,
  },
};

/** A further match listed under a result's Show more. */
const contentHit: ContentHitData = {
  content: 'notes in https://docs.<macro_em>planbook</macro_em>.example/d/1',
};

/** Search rows for the message and the document, wide, narrow and single
 * line, and a content hit row, each recording what a press opened. */
function Fixture() {
  const [opened, setOpened] = createSignal<string[]>([]);
  const record = (what: string) => setOpened((all) => [...all, what]);
  // Under 512px rows are narrow; phone search lists single-line rows edge to
  // edge.
  const lists = [
    { name: 'narrow', width: 'w-[480px]', layout: 'inbox', entity: message },
    {
      name: 'single-line',
      width: 'w-[480px]',
      layout: 'single-line',
      entity: message,
    },
    { name: 'wide', width: 'w-[900px]', layout: 'inbox', entity: message },
    {
      name: 'phone',
      width: '-mx-8 w-screen',
      layout: 'single-line',
      entity: message,
    },
    {
      name: 'title-single-line',
      width: 'w-[480px]',
      layout: 'single-line',
      entity: documentResult,
    },
    {
      name: 'title-wide',
      width: 'w-[900px]',
      layout: 'inbox',
      entity: documentResult,
    },
  ] as const;

  return (
    <main class="flex flex-col gap-6 bg-page p-8 text-ink">
      <For each={lists}>
        {(list) => {
          const [ref, setRef] = createSignal<HTMLElement>();
          return (
            <section
              data-testid={`list-${list.name}`}
              ref={setRef}
              class={list.width}
            >
              <ListLayoutProvider ref={ref} narrowLayout={list.layout}>
                <ListEntity
                  entity={list.entity}
                  onClick={() => record(`row-${list.name}`)}
                />
              </ListLayoutProvider>
            </section>
          );
        }}
      </For>
      <section data-testid="content-hit" class="w-[600px]">
        <SearchContentHitRow
          hit={contentHit}
          onClick={() => record('content-hit')}
        />
      </section>
      <output aria-label="Opened">{opened().join(',')}</output>
    </main>
  );
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

render(
  () => (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <ChannelDirectoryProvider
                directory={staticChannelDirectory(() => [])}
              >
                <QuickAccessProvider>
                  <EmailLinksContextProvider>
                    <MobileSettingsProvider>
                      <TagSetsProvider tagSets={() => []}>
                        <MemoryRouter>
                          <Route path="*" component={Fixture} />
                        </MemoryRouter>
                      </TagSetsProvider>
                    </MobileSettingsProvider>
                  </EmailLinksContextProvider>
                </QuickAccessProvider>
              </ChannelDirectoryProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);
