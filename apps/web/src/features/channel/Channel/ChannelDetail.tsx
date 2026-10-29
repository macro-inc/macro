import { ViewShell } from '@app/components/view-shell';
import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { ChannelAttachmentsTab } from '@channel/Attachments/ChannelAttachmentsTab';
import { useChannelBotManagement } from '@channel/Bots/use-channel-bot-management';
import { useCallContextOptional } from '@channel/Call/CallContext';
import { CallEventSync } from '@channel/Call/CallEventSync';
import { ChannelCallAutoJoin } from '@channel/Call/ChannelCallAutoJoin';
import { ChannelCallButton } from '@channel/Call/ChannelCallButton';
import { ChannelCallTab } from '@channel/Call/ChannelCallTab';
import { getCallJoinTab } from '@channel/Call/call-tabs';
import { useCall } from '@channel/Call/use-call';
import { ChannelCallsTab } from '@channel/Calls/ChannelCallsTab';
import { ChannelInviteButton } from '@channel/channel-invite-button';
import { ChannelTitleIcon } from '@channel/components/ChannelTopIcon';
import { DebugSuspense } from '@channel/DebugSuspense';
import { MediaDensityContext } from '@channel/Media/media-density';
import { ChannelParticipantsTab } from '@channel/Participants/ChannelParticipantsTab';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import {
  createPriorityCollapseController,
  PriorityCollapseOverflowSensor,
} from '@components/app/split-layout/components/PriorityCollapseOverflowSensor';
import {
  useRegisterPriorityCollapseItem,
  useSplitDisplayName,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import type { PriorityCollapser } from '@components/app/split-layout/utils/createPriorityCollapser';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import {
  useChannel,
  useChannelCanCall,
  useChannelName,
  useChannelType,
} from '@core/context/channels';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { createMethodRegistration } from '@core/orchestrator';
import { lazyNamed } from '@core/util/lazyNamed';
import { cn, Tabs } from '@ui';
import {
  type Accessor,
  children,
  createComputed,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { ChannelLoading } from './ChannelLoading';
import {
  ChannelMessages,
  ChannelSurface,
  type ChannelTargetRequest,
} from './ChannelSurface';
import { ChannelTabProvider, useChannelTab } from './ChannelTabContext';
import { ChannelThreadLayoutToggle } from './ChannelThreadLayoutToggle';
import { ChannelThreadPanel } from './ChannelThreadPanel';
import { ChannelLiveIndicators } from './ChannelTopBarLiveIndicators';
import { withChannelTabIcons } from './channel-tab-icons';
import { type ChannelTabId, DEFAULT_CHANNEL_TAB } from './channel-tabs';
import {
  isJoinCallRequested,
  isOpenCallTabRequested,
  toChannelTargetRequest,
  URL_PARAMS,
} from './link';
import {
  ChannelThreadPanelContext,
  createChannelThreadPanel,
} from './thread-panel';
import {
  canUseInlineCallTab,
  normalizeChannelTab,
  useChannelTabItems,
} from './use-channel-tab-items';

export type ChannelDetailContext = {
  channelId: string;
  name: Accessor<string>;
};

export type ChannelDetailProps = {
  channelId: string;
  /**
   * Navigation target, compared by value: a changed value re-navigates, a
   * re-derived equal value does not. A host that needs identity-request
   * semantics (re-issuing the same target navigates again) should compose
   * ChannelSurface directly.
   */
  target?: ChannelTargetRequest;
  /** Re-aim the current target without remounting the channel. */
  navigationRequest?: number | string;
  /** Name shown until the channel loads. */
  fallbackName?: string;
  /** Whether the composer grabs focus on mount. Defaults to false. */
  autofocus?: boolean;
  /** Render the host's header and register any host-specific breadcrumbs. */
  children: (context: ChannelDetailContext) => JSX.Element;
};

type ChannelDetailHeaderProps = {
  channelId: string;
  fallbackName?: string;
};

export function ChannelDetailTitle(props: ChannelDetailHeaderProps) {
  const channelName = useChannelName(props.channelId, props.fallbackName);

  return (
    <div class="ph-no-capture flex min-w-0 shrink items-center gap-2">
      <ChannelTitleIcon channelId={props.channelId} />
      <span class="truncate text-sm font-semibold">
        {channelName() ?? 'New Channel'}
      </span>
    </div>
  );
}

// Every channel host composes the top bar, so the menu's entity-action graph
// is a chunk of its own rather than weight in each of them.
const ChannelTitleMenu = lazyNamed(
  () => import('./ChannelTitleMenu'),
  'ChannelTitleMenu'
);

/**
 * The channel's tab strip. Given the top bar's `collapser`, the strip
 * registers as its first item to give up space, dropping text labels for
 * icons when the bar overflows and taking them back as room returns.
 */
export function ChannelDetailTabs(props: {
  channelId: string;
  collapser?: PriorityCollapser;
}) {
  const { activeTab, setActiveTab } = useChannelTab();
  const tabs = useChannelTabItems(props.channelId);
  const isCollapsed = props.collapser
    ? useRegisterPriorityCollapseItem(props.collapser, {
        id: 'channel-tabs',
        priority: 1,
      })
    : () => false;

  return (
    <Tabs
      aria-label="Channel sections"
      size="md"
      touch="inset"
      class="shrink-0"
      options={isCollapsed() ? withChannelTabIcons(tabs()) : tabs()}
      iconOnly={isCollapsed()}
      value={activeTab()}
      onChange={setActiveTab}
    />
  );
}

export function ChannelDetailActions(props: ChannelDetailHeaderProps) {
  const channel = useChannel(props.channelId);
  const channelName = useChannelName(props.channelId, props.fallbackName);
  const channelType = useChannelType(props.channelId);
  const call = useCall(() => props.channelId);

  // Seed for "Ask Macro": a new chat with this channel @mentioned.
  const askMacroEntity = () => {
    const type = channelType();
    if (!type) return undefined;
    return {
      type: 'channel' as const,
      id: props.channelId,
      name: channelName() ?? 'New Channel',
      channelType: type,
    };
  };

  return (
    <div class="header-actions ml-auto flex shrink-0 items-center gap-2 touch:gap-1">
      <DebugSuspense name="ChannelDetail.live-indicators">
        <ChannelLiveIndicators channelId={props.channelId} />
      </DebugSuspense>
      <HeaderActionGroup label="Conversation actions">
        <Show
          when={ENABLE_CALLS && !channel()?.agent_dm && !call.isInThisChannel()}
        >
          <DebugSuspense name="ChannelDetail.call-button">
            <ChannelCallButton grouped channelId={props.channelId} />
          </DebugSuspense>
        </Show>
        <Show when={askMacroEntity()}>
          {(entity) => (
            <DebugSuspense name="ChannelDetail.ask-macro">
              <ChatWithAgentButton
                grouped
                entity={entity()}
                label="Ask Macro"
              />
            </DebugSuspense>
          )}
        </Show>
      </HeaderActionGroup>
      <DebugSuspense name="ChannelDetail.invite">
        <ChannelInviteButton
          channelId={props.channelId}
          channelName={channelName() ?? 'New Channel'}
          channelType={channelType()}
        />
      </DebugSuspense>
    </div>
  );
}

/**
 * Channel top bar: leading content and tabs share one priority-collapse row
 * so a narrow pane shrinks the tabs to icons before the title truncates.
 * `leading` replaces the default title (a host's breadcrumbs, say); the title
 * menu, tabs, and actions are the bar's own, identical for every host.
 */
export function ChannelDetailTopBar(
  props: ChannelDetailHeaderProps & { leading?: JSX.Element }
) {
  const collapse = createPriorityCollapseController();

  return (
    <ViewShell.TopBar ref={collapse.setRow} class="gap-3 py-0">
      {/* Reserve room for the tab outline inside the clipped, measured region. */}
      <PriorityCollapseOverflowSensor
        controller={collapse}
        truncateAsLastResort
        class="relative h-full min-w-0 shrink overflow-hidden"
        contentClass="flex h-full items-center gap-3 not-touch:pr-1"
      >
        <div class="flex min-w-0 shrink items-center gap-1">
          <DebugSuspense name="ChannelDetail.title">
            <Show
              when={props.leading}
              fallback={
                <ChannelDetailTitle
                  channelId={props.channelId}
                  fallbackName={props.fallbackName}
                />
              }
            >
              {props.leading}
            </Show>
          </DebugSuspense>
          <DebugSuspense name="ChannelDetail.title-menu">
            <ChannelTitleMenu channelId={props.channelId} />
          </DebugSuspense>
        </div>
        <DebugSuspense name="ChannelDetail.tab-strip">
          <ChannelDetailTabs
            channelId={props.channelId}
            collapser={collapse.collapser}
          />
        </DebugSuspense>
        <ChannelThreadLayoutToggle />
      </PriorityCollapseOverflowSensor>
      <DebugSuspense name="ChannelDetail.actions">
        <ChannelDetailActions
          channelId={props.channelId}
          fallbackName={props.fallbackName}
        />
      </DebugSuspense>
    </ViewShell.TopBar>
  );
}

function ChannelDetailHeader(props: {
  render: ChannelDetailProps['children'];
  context: ChannelDetailContext;
}) {
  const resolved = children(() => props.render(props.context));
  return <>{resolved()}</>;
}

function ChannelDetailContent(props: ChannelDetailProps) {
  const panel = useSplitPanelOrThrow();
  const orchestrator = useGlobalBlockOrchestrator();
  const channelId = props.channelId;
  const conversationChannel = useChannel(channelId);
  const canCall = useChannelCanCall(channelId);
  const channelName = useChannelName(channelId, props.fallbackName);
  useSplitDisplayName(() => channelName() ?? 'New Channel');
  const analytics = useAnalytics();
  // Keyed by channel id, so this counts one open per channel shown.
  onMount(() => {
    analytics.pageView('channel');
    analytics.track('open_entity', {
      entityType: 'channel',
      entityId: channelId,
    });
  });

  const requestFromTarget = (
    target: ChannelTargetRequest | undefined
  ): ChannelTargetRequest | undefined => (target ? { ...target } : undefined);

  const targetKey = () => {
    const target = props.target;
    const location = !target
      ? ''
      : target.kind === 'latest'
        ? 'latest'
        : `${target.messageId}:${target.threadId ?? ''}`;
    return `${location}:${props.navigationRequest ?? 0}`;
  };

  // The surface navigates on a fresh request object. The host's `target` is
  // value-semantic, so it only produces one when its value changes; a mention
  // chip or notification arriving through the block handle always does.
  let lastTargetKey = targetKey();
  const [targetRequest, setTargetRequest] = createSignal<
    ChannelTargetRequest | undefined
  >(requestFromTarget(props.target));

  createComputed(() => {
    const key = targetKey();
    if (key === lastTargetKey) return;
    lastTargetKey = key;
    setTargetRequest(requestFromTarget(props.target));
  });

  const callCtx = useCallContextOptional();
  // A channel that owns this client's active call opens on the Call tab, so
  // selecting it never hides the live call — the block adapter's rule.
  const hasActiveCallHere = !!(
    callCtx?.isInCall() && callCtx.activeChannelId() === channelId
  );
  const [activeTab, setActiveTabInternal] = createSignal<ChannelTabId>(
    normalizeChannelTab(hasActiveCallHere ? 'call' : DEFAULT_CHANNEL_TAB)
  );
  const setActiveTab = (tab: ChannelTabId) => {
    setActiveTabInternal(
      conversationChannel()?.agent_dm &&
        ['call', 'calls', 'participants'].includes(tab)
        ? DEFAULT_CHANNEL_TAB
        : normalizeChannelTab(tab)
    );
  };
  createComputed(() => {
    if (
      conversationChannel()?.agent_dm &&
      ['call', 'calls', 'participants'].includes(activeTab())
    )
      setActiveTabInternal(DEFAULT_CHANNEL_TAB);
  });
  const [pendingJoinCall, setPendingJoinCall] = createSignal(false);
  const threadPanel = createChannelThreadPanel();

  // A new target within the already-mounted channel (a notification jump)
  // must land on the messages pane, whichever tab is open.
  createComputed(
    on(
      targetRequest,
      (request) => {
        if (request) setActiveTab(DEFAULT_CHANNEL_TAB);
      },
      { defer: true }
    )
  );

  // Mention chips, notifications, and call deep links aim an open channel
  // through its block handle; without one the click only activates the view.
  createComputed(() => {
    const handle = orchestrator.registerBlockHandle('channel', channelId);
    createMethodRegistration(() => handle, {
      goToLocationFromParams: async (params: Record<string, unknown>) => {
        // Store any message target first: a request that also opens the call
        // tab leaves it waiting for whenever the user returns to Messages.
        const request = toChannelTargetRequest(params);
        if (request) setTargetRequest(request);

        if (isOpenCallTabRequested(params[URL_PARAMS.openCallTab])) {
          setActiveTab(getCallJoinTab());
          return;
        }

        if (isJoinCallRequested(params[URL_PARAMS.joinCall])) {
          setActiveTab(getCallJoinTab());
          setPendingJoinCall(true);
        }
      },
      goToLatest: async () => {
        setTargetRequest({ kind: 'latest' });
      },
    });
  });

  // CallContext: which channel has the Call tab selected (for isCallPage(), etc.).
  createComputed(() =>
    callCtx?.syncCallPageTab(channelId, activeTab() === 'call')
  );
  onCleanup(() => callCtx?.syncCallPageTab(channelId, false));

  registerHotkey({
    scopeId: panel.splitHotkeyScope,
    hotkey: 'shift+cmd+e',
    hotkeyToken: TOKENS.channel.toggleThreadPanel,
    description: () =>
      threadPanel.enabled()
        ? 'Expand threads inline'
        : 'Collapse threads into a side panel',
    runWithInputFocused: true,
    condition: threadPanel.available,
    keyDownHandler: () => {
      threadPanel.setEnabled(!threadPanel.enabled());
      return true;
    },
  });

  const botManagement = useChannelBotManagement({
    channelId,
    hotkeyScopeId: panel.splitHotkeyScope,
    openParticipants: () => setActiveTab('participants'),
  });

  return (
    <ChannelSurface channelId={channelId} targetRequest={targetRequest()}>
      <DebugSuspense name="ChannelDetail.call-event-sync">
        <CallEventSync />
      </DebugSuspense>
      <ChannelThreadPanelContext.Provider value={threadPanel}>
        <ChannelTabProvider activeTab={activeTab} setActiveTab={setActiveTab}>
          <DebugSuspense name="ChannelDetail.auto-join">
            <ChannelCallAutoJoin
              canCall={canCall}
              channelId={channelId}
              pendingJoinCall={pendingJoinCall}
              onHandled={() => setPendingJoinCall(false)}
            />
          </DebugSuspense>
          <div class="flex size-full min-h-0 flex-col">
            <DebugSuspense name="ChannelDetail.header">
              <ChannelDetailHeader
                render={props.children}
                context={{
                  channelId,
                  name: () => channelName() ?? 'New Channel',
                }}
              />
            </DebugSuspense>
            <div
              class="flex min-h-0 flex-1 flex-col px-2"
              data-channel-tab-content
            >
              <Switch>
                <Match when={activeTab() === 'messages'}>
                  {/* A narrow pane gives the open thread the whole width.
                      Collapsed threads shrink message media to thumbnails. */}
                  <MediaDensityContext.Provider
                    value={() =>
                      threadPanel.enabled() ? 'compact' : 'regular'
                    }
                  >
                    <div class="@container/channel-body flex min-h-0 flex-1">
                      <div
                        class={cn(
                          'flex min-h-0 min-w-0 flex-1 flex-col',
                          threadPanel.openThreadId() &&
                            '@max-[44rem]/channel-body:hidden'
                        )}
                      >
                        <DebugSuspense
                          name="ChannelDetail.messages"
                          fallback={<ChannelLoading />}
                        >
                          <ChannelMessages
                            autofocus={props.autofocus ?? false}
                          />
                        </DebugSuspense>
                      </div>
                      <Show when={threadPanel.openThreadId()}>
                        {(threadId) => (
                          <DebugSuspense name="ChannelDetail.thread-panel">
                            <ChannelThreadPanel
                              channelId={channelId}
                              threadId={threadId()}
                              panel={threadPanel}
                            />
                          </DebugSuspense>
                        )}
                      </Show>
                    </div>
                  </MediaDensityContext.Provider>
                </Match>
                <Match when={activeTab() === 'attachments'}>
                  <DebugSuspense name="ChannelDetail.attachments">
                    <ChannelAttachmentsTab channelId={channelId} />
                  </DebugSuspense>
                </Match>
                <Match when={activeTab() === 'calls' && ENABLE_CALLS}>
                  <DebugSuspense name="ChannelDetail.calls">
                    <ChannelCallsTab channelId={channelId} />
                  </DebugSuspense>
                </Match>
                <Match when={activeTab() === 'participants'}>
                  <DebugSuspense name="ChannelDetail.participants">
                    <ChannelParticipantsTab
                      channelId={channelId}
                      botManagementEnabled={botManagement.enabled()}
                      onCreateBot={botManagement.openCreateBot}
                      inviteBotFocusRequest={botManagement.inviteFocusRequest()}
                      onOpenBot={botManagement.openBot}
                    />
                  </DebugSuspense>
                </Match>
                <Match when={activeTab() === 'call' && canUseInlineCallTab()}>
                  <DebugSuspense name="ChannelDetail.call">
                    <ChannelCallTab
                      channelId={channelId}
                      pendingJoin={pendingJoinCall}
                    />
                  </DebugSuspense>
                </Match>
              </Switch>
            </div>
          </div>
        </ChannelTabProvider>
      </ChannelThreadPanelContext.Provider>
    </ChannelSurface>
  );
}

/**
 * Channel body and per-channel tab state. Hosts compose the top bar from the
 * exported header parts through the children callback.
 *
 * Keys its content by channel id so switching channels remounts the timeline.
 * Hosts pass a reactive `channelId` and never key their own render.
 */
export function ChannelDetail(props: ChannelDetailProps) {
  return (
    <Show when={props.channelId} keyed>
      {(channelId) => (
        <DebugSuspense name="ChannelDetail.root">
          <ChannelDetailContent {...props} channelId={channelId} />
        </DebugSuspense>
      )}
    </Show>
  );
}
