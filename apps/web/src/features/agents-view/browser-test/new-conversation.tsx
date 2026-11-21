import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { CURSOR_BOT_PRINCIPAL_ID } from '@core/constant/cursorAgent';
import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import { MACRO_CODER_PRINCIPAL_ID } from '@core/constant/macroCoder';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type {
  QuickAccessContextValue,
  QuickAccessListOptions,
  UserItem,
} from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { EntityProvider } from '@entity';
import { botProfileKeys } from '@queries/bots/keys';
import { queryClient as client } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { buildAgentRoster } from '../core/roster';
import { NewChatPage, type StartConversation } from '../views/NewChatPage';

const PEOPLE: UserItem[] = [
  ['Macro', MACRO_AGENT_PRINCIPAL_ID, 'macro'],
  ['Cursor', CURSOR_BOT_PRINCIPAL_ID, 'cursor'],
  ['Macro Coding Agent', MACRO_CODER_PRINCIPAL_ID, 'coder'],
  ['Alex Rivera', 'macro|alex@example.com', 'alex@example.com'],
].map(([name, id, email], index) => ({
  kind: 'user',
  bucket: 'person',
  id,
  searchText: name,
  sortTimestamp: 1_000 - index,
  timestamps: {},
  data: { id, name, email },
}));

// The @ menu reads only people; every other bucket is empty.
const QUICK_ACCESS: QuickAccessContextValue = {
  useList: ((options?: QuickAccessListOptions<readonly ['person']>) => {
    const people = () => {
      if (!options?.buckets?.includes('person')) return [];
      const term = (options.searchTerm?.() ?? '').toLowerCase();
      return PEOPLE.filter((person) =>
        person.searchText.toLowerCase().includes(term)
      );
    };
    return {
      items: people,
      totalCount: () => people().length,
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
  getById: () => undefined,
  interactionForUser: () => undefined,
};

const ROSTER = buildAgentRoster({
  agents: [],
  runtimes: [],
  cursorConnected: true,
  cursorNeedsConnection: false,
  macroDefaultModel: 'chat-default',
  cursorDefaultModel: 'cursor-default',
});

/** The Agents page's new-conversation composer, with a log of what it starts. */
function Fixture() {
  const [started, setStarted] = createSignal<StartConversation[]>([]);
  const agentName = (botId: string | undefined) =>
    ROSTER.find((agent) => agent.botId === botId)?.name ?? 'Macro';
  return (
    <main class="min-h-screen bg-page p-4 text-ink">
      <NewChatPage
        roster={ROSTER}
        rosterLoading={false}
        onStart={(start) => setStarted((all) => [...all, start])}
        onOpenRoster={() => {}}
      />
      <section aria-label="Started" class="mx-auto mt-6 max-w-2xl text-sm">
        <For each={started()}>
          {(start) => (
            <p>
              Started {agentName(start.botId)}: {start.prompt}
            </p>
          )}
        </For>
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
// EntityProvider installs the app's own client, so the profiles are seeded
// there for the mention chips to read; the outer provider shares it.
client.setDefaultOptions({ queries: { retry: false } });
// Mention chips show an agent's current name from its profile.
for (const person of PEOPLE) {
  if (!person.id.startsWith('bot|')) continue;
  client.setQueryData(
    botProfileKeys.detail(person.id.slice('bot|'.length)).queryKey,
    { name: person.data.name, avatarUrl: undefined, deleted: false }
  );
}
render(
  () => (
    <QueryClientProvider client={client}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <QuickAccessContextProvider value={QUICK_ACCESS}>
                    <MobileSettingsProvider>
                      <MemoryRouter>
                        <Route path="*" component={Fixture} />
                      </MemoryRouter>
                    </MobileSettingsProvider>
                  </QuickAccessContextProvider>
                </ChannelsContextProvider>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  root
);
