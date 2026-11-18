import '@app/index.css';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { EmailSenderIcon } from '@app/features/email-message/sender-icon-adapter';
import { EmailMessageView } from '@app/features/email-message/views/email-message';
import { TagSetsProvider } from '@app/features/property/tags/tag-sets-context';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EntityProvider } from '@entity';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { ListEntity, ListLayoutProvider } from '../composed/ListEntity';
import type { EmailEntity } from '../types/entity';

const SENDERS = ['Ada Lovelace', 'Alan Turing', 'Barbara Liskov'];

const threads = SENDERS.map(
  (name, i) =>
    ({
      id: `thread-${i + 1}`,
      type: 'email',
      name: `Subject ${i + 1}`,
      // Two senders, the second a shared notification address, as on a
      // GitHub thread: hovering the second name is where clicks were lost.
      participants: [
        { email: `sender${i + 1}@example.com`, name },
        { email: 'notifications@example.com', name: 'macro-application[bot]' },
      ],
    }) as unknown as EmailEntity
);

const messages = SENDERS.map(
  (name, i) =>
    ({
      db_id: `message-${i + 1}`,
      thread_db_id: 'thread-1',
      link_id: 'link-1',
      from: { email: `sender${i + 1}@example.com`, name },
      to: [{ email: 'viewer@example.com', name: 'Viewer' }],
      cc: [],
      bcc: [],
      labels: [],
      attachments: [],
      attachments_draft: [],
      attachments_forwarded: [],
      body_text: `Message ${i + 1}`,
      internal_date_ts: '2026-11-01T10:00:00Z',
      created_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
      is_draft: false,
      is_read: true,
    }) as unknown as EmailMessage
);

/**
 * Mail rows (the reading-pane list and the wide list) and a thread's collapsed
 * messages, each recording what a click opened.
 */
function Fixture() {
  const [openedThreads, setOpenedThreads] = createSignal<string[]>([]);
  const [expandedMessages, setExpandedMessages] = createSignal<string[]>([]);
  const lists = [
    { name: 'narrow', width: 'w-80' },
    { name: 'wide', width: 'w-[900px]' },
  ];

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
              <ListLayoutProvider ref={ref} narrowLayout="inbox">
                <For each={threads}>
                  {(thread) => (
                    <ListEntity
                      entity={thread}
                      onClick={() =>
                        setOpenedThreads((ids) => [...ids, thread.id])
                      }
                    />
                  )}
                </For>
              </ListLayoutProvider>
            </section>
          );
        }}
      </For>
      <section data-testid="thread" class="flex w-[600px] flex-col gap-2">
        <For each={messages}>
          {(message) => (
            <EmailMessageView
              message={message}
              renderAvatar={(m) => <EmailSenderIcon message={m} />}
              isTouch={isTouchDevice()}
              isPersonal
              isSelected={false}
              allowHover
              isExpanded={false}
              onExpand={() =>
                setExpandedMessages((ids) => [...ids, message.db_id])
              }
            />
          )}
        </For>
      </section>
      <output aria-label="Opened threads">{openedThreads().join(',')}</output>
      <output aria-label="Expanded messages">
        {expandedMessages().join(',')}
      </output>
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
              <ChannelsContextProvider>
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
              </ChannelsContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);
