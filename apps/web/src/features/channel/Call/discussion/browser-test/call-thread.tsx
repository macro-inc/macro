import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import type { BlockOrchestrator } from '@core/orchestrator';
import { EntityProvider } from '@entity';
import type { NotificationSource } from '@notifications';
import { authKeys, type UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { createSignal, Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import { Channel } from '../../../Channel/Channel';
import { ChannelTabProvider } from '../../../Channel/ChannelTabContext';
import type { ChannelTabId } from '../../../Channel/channel-tabs';
import { CallProvider } from '../../CallContext';
import { ChannelCallPanel } from '../ChannelCallPanel';

// Only the app's data boundary is replaced; the channel on top of it is real.
const NO_NOTIFICATIONS = {
  notificationsByEntity: () => ({}),
  bulkMarkAsRead: async () => undefined,
} as unknown as NotificationSource;
const NO_BLOCKS = {} as BlockOrchestrator;

// A signed-in viewer, without a session: nothing here reaches a real account.
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|me@example.com',
  permissions: [],
} as unknown as UserInfoData);

const CHANNEL_ID = '00000000-0000-7000-8000-00000000c0c0';
const CALL_ID = '00000000-0000-7000-8000-0000000ca110';

/** The Messages tab and the call's panel, swapped the way a person moves between them. */
function Fixture() {
  useHotKeyRoot();
  const initial = new URLSearchParams(location.search).get('view');
  const [tab, setTab] = createSignal<ChannelTabId>(
    initial === 'panel' ? 'call' : 'messages'
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <CallProvider>
                    <QuickAccessProvider>
                      <GlobalAppStateProvider
                        notificationSource={NO_NOTIFICATIONS}
                        blockOrchestrator={NO_BLOCKS}
                      >
                        <DragDropProvider>
                          <ChannelTabProvider
                            activeTab={tab}
                            setActiveTab={setTab}
                          >
                            <main class="flex h-screen min-h-0 flex-col bg-page text-ink">
                              <Suspense>
                                <Show
                                  when={tab() === 'call'}
                                  fallback={
                                    <div
                                      class="flex min-h-0 flex-1 flex-col"
                                      data-testid="messages-tab"
                                    >
                                      <Channel
                                        channelId={CHANNEL_ID}
                                        autofocus={false}
                                      />
                                    </div>
                                  }
                                >
                                  <div
                                    class="mx-auto flex min-h-0 w-full max-w-[372px] flex-1 flex-col bg-surface-2"
                                    data-testid="call-panel"
                                  >
                                    <ChannelCallPanel
                                      channelId={CHANNEL_ID}
                                      rootId={CALL_ID}
                                      onViewChannel={() => setTab('messages')}
                                    />
                                  </div>
                                </Show>
                              </Suspense>
                            </main>
                          </ChannelTabProvider>
                        </DragDropProvider>
                      </GlobalAppStateProvider>
                    </QuickAccessProvider>
                  </CallProvider>
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
if (root) render(() => <Fixture />, root);
