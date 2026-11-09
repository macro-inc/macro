import { CallFullscreenProvider } from '../../call-fullscreen-host';
import { CallVolumeProvider, useCallVolumeOptional } from '../../call-volume';
import '@app/index.css';
import { CallOverlay as MainCallOverlay } from 'virtual:baseline-call-overlay';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { GlobalAppStateProvider } from '@components/app/GlobalAppState';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { BlockOrchestrator } from '@core/orchestrator';
import { EntityProvider } from '@entity';
import { Popover } from '@kobalte/core/popover';
import type { NotificationSource } from '@notifications';
import { authKeys, type UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { ImperativeDialogHost } from '@ui';
import { createSignal, Match, Show, Suspense, Switch } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import { ChannelTabProvider } from '../../../Channel/ChannelTabContext';
import type { ChannelTabId } from '../../../Channel/channel-tabs';
import { ActiveCallHeader } from '../../ActiveCallHeader';
import { ActiveCallPopover } from '../../ActiveCallPopover';
import { useCallContext } from '../../CallContext';
import { CallMiniPlayer } from '../../CallMiniPlayer';
import { CallOverlay } from '../../CallOverlay';
import { CallDiscussionContent } from '../CallDiscussionContent';

function SeedVolume() {
  const volumes = useCallVolumeOptional();
  const call = useCallContext();
  if (new URLSearchParams(location.search).get('mutedForYou') === 'true') {
    for (const participant of call.remoteParticipants().values())
      volumes?.set(participant, 0);
  }
  return null;
}

applyTheme(
  new URLSearchParams(location.search).get('theme') === 'light'
    ? 'Macro Light'
    : 'Macro Dark'
);
document.documentElement.dataset.touchDevice = String(isTouchDevice());
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: 'macro|me@example.com',
  permissions: [],
} as unknown as UserInfoData);
const notifications = {
  notificationsByEntity: () => ({}),
  bulkMarkAsRead: async () => undefined,
} as unknown as NotificationSource;
const blocks = {} as BlockOrchestrator;

function Fixture() {
  const [surfaceOverride, setSurfaceOverride] = createSignal(false);
  useHotKeyRoot();
  const [tab, setTab] = createSignal<ChannelTabId>('call');
  const params = new URLSearchParams(location.search);
  return (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <QuickAccessProvider>
                    <GlobalAppStateProvider
                      notificationSource={notifications}
                      blockOrchestrator={blocks}
                    >
                      <DragDropProvider>
                        <ChannelTabProvider
                          activeTab={tab}
                          setActiveTab={setTab}
                        >
                          <button
                            class="absolute top-0 left-0 z-50"
                            onClick={() =>
                              queryClient.refetchQueries({ type: 'all' })
                            }
                          >
                            Refresh discussion
                          </button>
                          <ImperativeDialogHost />
                          <CallVolumeProvider>
                            <SeedVolume />
                            <CallFullscreenProvider
                              callId={() => 'fixture-call'}
                            >
                              <main class="h-screen bg-page text-ink">
                                <Show when={params.get('headerWidth')}>
                                  {(width) => (
                                    <header
                                      class="@container/channel-header"
                                      style={{ width: `${width()}px` }}
                                    >
                                      <div class="flex items-center gap-3 p-2">
                                        <span class="min-w-0 flex-1 truncate">
                                          Call channel
                                        </span>
                                        <ActiveCallHeader channelId="00000000-0000-7000-8000-00000000c0c0" />
                                      </div>
                                    </header>
                                  )}
                                </Show>
                                <Suspense>
                                  <Switch>
                                    <Match
                                      when={params.get('surface') === 'player'}
                                    >
                                      <CallMiniPlayer
                                        onCollapse={() => {}}
                                        onOpenCall={() => {}}
                                      />
                                    </Match>
                                    <Match
                                      when={
                                        params.get('surface') === 'popover' &&
                                        !surfaceOverride()
                                      }
                                    >
                                      <Popover open>
                                        <Popover.Anchor>
                                          <span class="absolute top-20 left-20">
                                            Call
                                          </span>
                                        </Popover.Anchor>
                                        <ActiveCallPopover
                                          onOpenCall={() =>
                                            setSurfaceOverride(true)
                                          }
                                          onShowPlayer={() => {}}
                                        />
                                      </Popover>
                                    </Match>
                                    <Match when={true}>
                                      <Dynamic
                                        component={
                                          params.get('baseline') === 'main'
                                            ? MainCallOverlay
                                            : CallOverlay
                                        }
                                        onLeave={() => undefined}
                                        showTeamSharing={false}
                                        showChat={params.get('chat') !== 'off'}
                                        discussion={{
                                          label: () => undefined,
                                          opensByDefault: () =>
                                            params.get('view') === 'panel',
                                          hasUpdates: () =>
                                            params.get('unread') === 'true',
                                          render: (panel) => (
                                            <CallDiscussionContent
                                              discussion={() => ({
                                                kind: 'channel_thread',
                                                channel_id:
                                                  '00000000-0000-7000-8000-00000000c0c0',
                                                root_id:
                                                  '00000000-0000-7000-8000-0000000ca110',
                                              })}
                                              panel={panel}
                                              onViewChannel={() => undefined}
                                            />
                                          ),
                                        }}
                                      />
                                    </Match>
                                  </Switch>
                                </Suspense>
                              </main>
                            </CallFullscreenProvider>
                          </CallVolumeProvider>
                        </ChannelTabProvider>
                      </DragDropProvider>
                    </GlobalAppStateProvider>
                  </QuickAccessProvider>
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
if (root)
  render(
    () => (
      <MemoryRouter>
        <Route path="*" component={Fixture} />
      </MemoryRouter>
    ),
    root
  );
