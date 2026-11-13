import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import { Resize } from '@core/component/Resize';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
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
import {
  CallChatPanel,
  type CallPanelTab,
} from '../../chat/components/CallChatPanel';
import { CallDiscussionContent } from '../CallDiscussionContent';

// Only the app's data boundary is replaced; the channel on top of it is real.
const NO_NOTIFICATIONS = {
  notificationsByEntity: () => ({}),
  bulkMarkAsRead: async () => undefined,
} as unknown as NotificationSource;
const NO_BLOCKS = {} as BlockOrchestrator;

// A signed-in viewer, without a session: nothing here reaches a real account.
document.documentElement.dataset.touchDevice = String(isTouchDevice());
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
  const shell = new URLSearchParams(location.search).get('shell');
  const [panelOpen, setPanelOpen] = createSignal(true);
  const [panelTab, setPanelTab] = createSignal<CallPanelTab>('chat');
  const [sidebar, setSidebar] = createSignal<HTMLDivElement>();
  const [overlay, setOverlay] = createSignal<HTMLDivElement>();
  const Discussion = () => (
    <CallDiscussionContent
      access={{ kind: 'member' }}
      discussion={() => ({
        kind: 'channel_thread',
        channel_id: CHANNEL_ID,
        root_id: CALL_ID,
      })}
      panel={{
        get open() {
          return panelOpen() && panelTab() === 'chat';
        },
        focusOnOpen: false,
        onClose: () => setPanelOpen(false),
      }}
      onViewChannel={() => setTab('messages')}
    />
  );
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
                                  <Show
                                    when={shell}
                                    fallback={
                                      <div
                                        class="mx-auto flex min-h-0 w-full max-w-[372px] flex-1 flex-col bg-surface-2"
                                        data-testid="call-panel"
                                      >
                                        <Discussion />
                                      </div>
                                    }
                                  >
                                    <button
                                      onClick={() => setPanelOpen(!panelOpen())}
                                    >
                                      {panelOpen()
                                        ? 'Leave call view'
                                        : 'Return to call view'}
                                    </button>
                                    <button
                                      onClick={() =>
                                        queryClient.refetchQueries({
                                          type: 'all',
                                        })
                                      }
                                    >
                                      Refresh discussion
                                    </button>
                                    <div
                                      ref={setOverlay}
                                      class="@container/call relative mx-auto min-h-0 w-full flex-1"
                                      style={{
                                        'max-width':
                                          shell === 'overlay'
                                            ? '640px'
                                            : undefined,
                                      }}
                                    >
                                      <Resize.Zone
                                        direction="horizontal"
                                        gutter={12}
                                        showDividers={false}
                                      >
                                        <Resize.Panel id="stage" minSize={200}>
                                          <div class="h-full" />
                                        </Resize.Panel>
                                        <Resize.Panel
                                          id="sidebar"
                                          minSize={280}
                                          target={{ kind: 'px', px: 380 }}
                                          hidden={() =>
                                            shell !== 'docked' || !panelOpen()
                                          }
                                          persistent
                                        >
                                          <div
                                            ref={setSidebar}
                                            class="h-full py-2"
                                          />
                                        </Resize.Panel>
                                      </Resize.Zone>
                                      <CallChatPanel
                                        id="fixture-call-panel"
                                        open={panelOpen()}
                                        onClose={() => setPanelOpen(false)}
                                        activeTab={panelTab()}
                                        onTabChange={setPanelTab}
                                        chatAvailable
                                        participantCount={2}
                                        participants={<p>Call participant</p>}
                                        sidebarMount={
                                          shell === 'docked'
                                            ? sidebar()
                                            : undefined
                                        }
                                        overlayMount={overlay()}
                                      >
                                        <Discussion />
                                      </CallChatPanel>
                                    </div>
                                  </Show>
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
