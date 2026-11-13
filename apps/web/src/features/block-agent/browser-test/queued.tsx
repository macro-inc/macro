/**
 * The queued-message cards above the agent composer, with the real
 * composer below them so Up / Enter / Escape travel the way they do in a
 * session. `?count=N` queues N prompts (default 3); `?light` renders the
 * light theme. Edits and removals land in the log under the composer.
 */
import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type {
  QuickAccessContextValue,
  QuickAccessList,
} from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EntityProvider } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { AgentInput } from '../ui/AgentInput';
import { type QueuedPromptItem, QueuedPrompts } from '../ui/QueuedPrompts';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const params = new URLSearchParams(location.search);
document.documentElement.dataset.themeLight = String(params.has('light'));

// The composer's mention menu needs a Quick Access source; nothing here
// mentions anything, so an empty one keeps the fixture backend-free.
const EMPTY_LIST: QuickAccessList = {
  items: () => [],
  totalCount: () => 0,
  hasMore: () => false,
  isLoading: () => false,
  isLoadingMore: () => false,
  error: () => undefined,
  loadMore: async () => {},
};
const QUICK_ACCESS: QuickAccessContextValue = {
  useList: (() => EMPTY_LIST) as QuickAccessContextValue['useList'],
  usesRecordSelection: () => false,
  usesSearchProjection: () => false,
  isLoading: () => false,
  refresh: () => {},
  getById: () => undefined,
  interactionForUser: () => undefined,
};

const PROMPTS = [
  'now a long poem about birds',
  'Then summarize it in one line, and mention <m-link>{"url":"https://example.com/birds","text":"the field guide"}</m-link>',
  'Finally, a haiku that goes on for long enough that the single-line preview has to truncate it somewhere near the end of the card',
  'Compare the two poems',
  'List every bird you named',
];

function Fixture() {
  const count = Number(params.get('count') ?? 3);
  // Past the samples, prompts repeat so a long queue can still be rendered.
  const [items, setItems] = createSignal<QueuedPromptItem[]>(
    Array.from({ length: count }, (_, index) => ({
      actionId: `queued-${index + 1}`,
      kind: 'prompt',
      prompt: PROMPTS[index % PROMPTS.length] ?? '',
    }))
  );
  const [log, setLog] = createSignal<string[]>([]);
  const record = (line: string) => setLog((lines) => [...lines, line]);
  let focusQueueBottom: (() => void) | undefined;
  let focusInput: (() => void) | undefined;

  const client = new QueryClient();
  const wrapper = createLexicalWrapper({
    type: 'chat',
    namespace: 'queued-fixture',
    isInteractable: () => false,
  });
  onCleanup(() => {
    wrapper.cleanup();
    client.clear();
  });

  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <LexicalWrapperContext.Provider
                    value={{ ...wrapper, skipPreviewFetch: true }}
                  >
                    <StaticMarkdownContext theme={channelTheme}>
                      <QuickAccessContextProvider value={QUICK_ACCESS}>
                        <main class="min-h-screen bg-page p-4 text-ink">
                          <div class="mx-auto max-w-3xl pt-24">
                            <div class="pb-1.5">
                              <div class="mb-1 px-1 text-xs text-ink-muted">
                                {items().length} queued
                              </div>
                              <div class="max-h-[25dvh] overflow-y-auto overscroll-contain">
                                <QueuedPrompts
                                  items={items()}
                                  onEdit={(actionId, prompt) => {
                                    setItems((current) =>
                                      current.map((item) =>
                                        item.actionId === actionId
                                          ? { ...item, prompt }
                                          : item
                                      )
                                    );
                                    record(`edit ${actionId}: ${prompt}`);
                                  }}
                                  onRemove={(actionId) => {
                                    setItems((current) =>
                                      current.filter(
                                        (item) => item.actionId !== actionId
                                      )
                                    );
                                    record(`remove ${actionId}`);
                                  }}
                                  onSteer={(actionId) =>
                                    record(`steer ${actionId}`)
                                  }
                                  onNavigateBelow={() => focusInput?.()}
                                  registerFocusFromBelow={(focus) => {
                                    focusQueueBottom = focus;
                                  }}
                                />
                              </div>
                            </div>
                            <AgentInput
                              busy
                              autofocus
                              placeholder="Message the agent, @mention anything"
                              onSend={(markdown) => record(`send: ${markdown}`)}
                              onStop={() => record('stop')}
                              onNavigateUp={
                                items().length > 0
                                  ? () => focusQueueBottom?.()
                                  : undefined
                              }
                              registerFocus={(focus) => {
                                focusInput = focus;
                              }}
                            />
                            <ol
                              class="mt-6 text-xs text-ink-muted"
                              data-testid="fixture-log"
                            >
                              <For each={log()}>
                                {(line) => <li>{line}</li>}
                              </For>
                            </ol>
                          </div>
                        </main>
                      </QuickAccessContextProvider>
                    </StaticMarkdownContext>
                  </LexicalWrapperContext.Provider>
                </ChannelsContextProvider>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
