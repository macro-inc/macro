import {
  ChatWithAgentButton,
  ChatWithAgentIcon,
  openChatWithAgent,
} from '@app/features/chat/ChatWithAgentButton';
import {
  makeRenameAction,
  useBlockEntityCommands,
} from '@app/features/next-soup/actions';
import { globalSplitManager } from '@app/signal/splitLayout';
import { URL_PARAMS } from '@block-channel/constants';
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
import type { MessageTimelineStateSnapshot } from '@channel/Channel/Channel';
import {
  ChannelMessages,
  ChannelSurface,
  type ChannelSurfaceApi,
  type ChannelTargetRequest,
} from '@channel/Channel/ChannelSurface';
import {
  ChannelTabProvider,
  useChannelTab,
} from '@channel/Channel/ChannelTabContext';
import { ChannelTopBarLiveIndicators } from '@channel/Channel/ChannelTopBarLiveIndicators';
import { CHANNEL_TAB_ICONS } from '@channel/Channel/channel-tab-icons';
import {
  type ChannelTabId,
  DEFAULT_CHANNEL_TAB,
} from '@channel/Channel/channel-tabs';
import {
  URL_PARAMS as CHANNEL_URL_PARAMS,
  isJoinCallRequested,
  isOpenCallTabRequested,
  toChannelTargetRequest,
} from '@channel/Channel/link';
import {
  canUseInlineCallTab,
  normalizeChannelTab,
  useChannelTabItems,
} from '@channel/Channel/use-channel-tab-items';
import { ChannelInviteButton } from '@channel/channel-invite-button';
import { useChannelPictureActions } from '@channel/channel-picture';
import { ChannelParticipantsTab } from '@channel/Participants/ChannelParticipantsTab';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { BlockSplitFileMenu } from '@components/app/split-layout/components/SplitFileMenu';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { SplitTitleFileMenu } from '@components/app/split-layout/components/SplitLabel';
import {
  useCanAutofocusSplitContent,
  useSplitPanelOrThrow,
} from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useBlockId } from '@core/block';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import {
  useChannel,
  useChannelName,
  useChannelType,
} from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHotkeyScopeSignal } from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import { buildEntityData } from '@entity';
import PictureIcon from '@phosphor/image.svg';
import RenameIcon from '@phosphor/pencil-line.svg';
import TrashIcon from '@phosphor/trash.svg';
import { useActiveCallQuery } from '@queries/call/call';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import { ChannelType } from '@service-storage/generated/schemas/channelType';
import { useSearchParams } from '@solidjs/router';
import { cn } from '@ui';
import {
  createComputed,
  createSignal,
  Match,
  onCleanup,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { ChannelTopLeft } from './Top';

const CHANNEL_STATE_ENTRY_KEY = 'channel.state';

type ChannelTargetMessageParams = {
  [URL_PARAMS.message]?: string;
  [URL_PARAMS.thread]?: string;
  [CHANNEL_URL_PARAMS.joinCall]?: string;
  [CHANNEL_URL_PARAMS.openCallTab]?: string;
};

export type BlockChannelProps = ChannelTargetMessageParams;

type ChannelEntryStateSnapshot = {
  activeTab?: ChannelTabId;
  messages?: MessageTimelineStateSnapshot;
};

const initialChannelTab = (options: {
  wantsJoinCall: boolean;
  hasActiveCallHere: boolean;
  persistedTab?: ChannelTabId;
}) => {
  return normalizeChannelTab(
    options.wantsJoinCall || options.hasActiveCallHere
      ? 'call'
      : (options.persistedTab ?? DEFAULT_CHANNEL_TAB)
  );
};

function NewTop(props: { channelId: string }) {
  const { activeTab, setActiveTab } = useChannelTab();
  const channelName = useChannelName(props.channelId);
  const channelType = useChannelType(props.channelId);
  const channel = useChannel(props.channelId);
  const userId = useUserId();
  const renameAction = makeRenameAction({ userId });
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const call = useCall(() => props.channelId);
  const activeCallQuery = useActiveCallQuery(() => props.channelId);
  const participants = () =>
    participantsQuery.isLoading ? [] : participantsQuery.data;
  const picture = useChannelPictureActions({
    channelId: () => props.channelId,
    canEdit: () =>
      channelType() !== ChannelType.direct_message &&
      (participants() ?? []).some(
        (participant) =>
          participant.user_id === userId() &&
          (participant.role === 'admin' || participant.role === 'owner')
      ),
  });
  const tabs = useChannelTabItems(props.channelId);

  const channelEntity = () => {
    const ch = channel();
    if (!ch) return undefined;
    return buildEntityData({
      id: props.channelId,
      name: ch.name ?? 'New Channel',
      blockName: 'channel',
      channelType: ch.channel_type,
      ownerId: ch.owner_id,
      isParticipant: participantsQuery.isSuccess
        ? (participantsQuery.data ?? []).some(
            (participant) => participant.user_id === userId()
          )
        : undefined,
    });
  };

  // Seed for "Ask Macro": a new chat with this channel @mentioned, so the
  // user does not have to create an agent and mention the channel by hand.
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

  // Mobile has no room for inline tabs; the title file-menu drawer leads with
  // them instead, as a titled radio group mirroring the active tab. Built
  // from tabs() so the call tab keeps its live-call label.
  const mobileViews = () => ({
    title: 'View',
    options: tabs().map((tab) => ({
      value: tab.value,
      label: tab.label,
      icon: CHANNEL_TAB_ICONS[tab.value as ChannelTabId],
    })),
    value: activeTab(),
    onSelect: (value: string) => setActiveTab(value as ChannelTabId),
  });

  return (
    <Suspense>
      <ChannelTopLeft
        channelId={props.channelId}
        channelType={channelType()!}
        participants={participants() ?? []}
        channelName={channelName() ?? 'New Channel'}
        tabs={tabs()}
        activeTab={activeTab()}
        onTabChange={setActiveTab}
      />
      <SplitTitleFileMenu>
        <BlockSplitFileMenu
          id={props.channelId}
          itemType="channel"
          name={channelName() ?? 'New Channel'}
          ops={[]}
          // Generic chrome can't reconstruct a ChannelEntity (it lacks the
          // channelType), so supply it for the menu's entity-gated items.
          entity={channelEntity()}
          mobileViews={isMobile() ? mobileViews() : undefined}
          tools={[
            {
              label: 'Ask Macro',
              icon: ChatWithAgentIcon,
              action: () => {
                const entity = askMacroEntity();
                if (!entity) return;
                void openChatWithAgent(entity);
              },
              // Desktop gets a header button instead (see below).
              condition: () => isMobile() && !!askMacroEntity(),
            },
            {
              group: 'file',
              label: 'Rename',
              icon: RenameIcon,
              hotkeyToken: TOKENS.entity.action.rename,
              action: () => {
                const entity = channelEntity();
                if (!entity) return;
                void renameAction.execute([entity]);
              },
              condition: () => {
                const entity = channelEntity();
                return !!entity && renameAction.canExecute(entity);
              },
            },
            {
              group: 'file',
              label: 'Set channel picture',
              icon: PictureIcon,
              action: picture.pickFile,
              condition: picture.isAvailable,
            },
            {
              group: 'file',
              label: 'Remove channel picture',
              icon: TrashIcon,
              action: picture.remove,
              condition: () => picture.isAvailable() && picture.hasPicture(),
            },
          ]}
        />
      </SplitTitleFileMenu>
      <SplitHeaderRight>
        <ChannelInviteButton
          channelId={props.channelId}
          channelName={channelName() ?? 'New Channel'}
          channelType={channelType()}
        />
      </SplitHeaderRight>
      {/* Desktop only: on mobile the action lives in the title drawer above. */}
      <Show when={!isMobile() && askMacroEntity()}>
        {(entity) => (
          <SplitHeaderRight>
            <HeaderIsland>
              <ChatWithAgentButton entity={entity()} label="Ask Macro" />
            </HeaderIsland>
          </SplitHeaderRight>
        )}
      </Show>
      {/* Hidden once the user has joined — the call surface owns the UI. */}
      <Show when={ENABLE_CALLS && !call.isInThisChannel()}>
        <SplitHeaderRight>
          <HeaderIsland
            class={cn(
              'px-1',
              // Call in progress: tint the whole island, matching the call
              // button's `success` variant.
              !!activeCallQuery.data &&
                'bg-success ring-success [&_button]:text-surface'
            )}
          >
            <div class="flex items-center gap-1.5">
              <ChannelCallButton channelId={props.channelId} />
            </div>
          </HeaderIsland>
        </SplitHeaderRight>
      </Show>
      <ChannelTopBarLiveIndicators />
    </Suspense>
  );
}

export function NewChannelBlockAdapter(props: BlockChannelProps) {
  // Every other block gets its hotkey scope from `BlockContainer`, which the
  // channel block does not render — so set `blockHotkeyScopeSignal` here or
  // `useBlockEntityCommands` would register nothing at all. Commands go on
  // the split scope so they keep working while focus sits on split chrome
  // (header, toolbar, panel div) and across in-split navigation — same as
  // BlockContainer. The adapter requires a split panel, so unlike
  // BlockContainer it needs no fallback DOM scope of its own.
  const splitPanel = useSplitPanelOrThrow();
  blockHotkeyScopeSignal.set(splitPanel.splitHotkeyScope);
  useBlockEntityCommands();
  const canAutofocusSplitContent = useCanAutofocusSplitContent();
  const { navigatedFromJK } = useNavigatedFromJK();
  const channelId = useBlockId();
  const blockHandle = blockHandleSignal.get;
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTargetMessageParams = (): ChannelTargetMessageParams => {
    const hasPropsTarget =
      props[URL_PARAMS.message] !== undefined ||
      props[URL_PARAMS.thread] !== undefined;
    if (hasPropsTarget) {
      return {
        [URL_PARAMS.message]: props[URL_PARAMS.message],
        [URL_PARAMS.thread]: props[URL_PARAMS.thread],
      };
    }
    const isSingleSplit = globalSplitManager()?.splits().length === 1;
    if (!isSingleSplit) return {};
    return {
      [URL_PARAMS.message]: searchParams[URL_PARAMS.message] as
        | string
        | undefined,
      [URL_PARAMS.thread]: searchParams[URL_PARAMS.thread] as
        | string
        | undefined,
    };
  };

  // Decide whether the user asked to auto-join the call (via ?join_call=true
  // deep link or programmatic open props) before creating signals so we
  // can land directly on the Call tab without flashing Messages first.
  const wantsJoinCall =
    isJoinCallRequested(props[CHANNEL_URL_PARAMS.joinCall]) ||
    isJoinCallRequested(searchParams[CHANNEL_URL_PARAMS.joinCall]);

  const callCtx = useCallContextOptional();
  const hasActiveCallHere = !!(
    callCtx?.isInCall() && callCtx.activeChannelId() === channelId
  );
  const persistedChannelState = splitPanel.handle.currentEntryState()?.[
    CHANNEL_STATE_ENTRY_KEY
  ] as ChannelEntryStateSnapshot | undefined;

  const hasInitialTargetRequest = () => {
    const hasPropsTarget =
      props[URL_PARAMS.message] !== undefined ||
      props[URL_PARAMS.thread] !== undefined;
    if (hasPropsTarget) return true;

    const isSingleSplit = globalSplitManager()?.splits().length === 1;
    if (!isSingleSplit) return false;

    return (
      searchParams[URL_PARAMS.message] !== undefined ||
      searchParams[URL_PARAMS.thread] !== undefined
    );
  };

  const shouldHydratePersistedChannelState =
    !wantsJoinCall &&
    !hasActiveCallHere &&
    !isOpenCallTabRequested(props[CHANNEL_URL_PARAMS.openCallTab]) &&
    !isOpenCallTabRequested(searchParams[CHANNEL_URL_PARAMS.openCallTab]) &&
    !hasInitialTargetRequest();

  const [activeTab, setActiveTabInternal] = createSignal<ChannelTabId>(
    initialChannelTab({
      wantsJoinCall,
      hasActiveCallHere,
      persistedTab: shouldHydratePersistedChannelState
        ? persistedChannelState?.activeTab
        : undefined,
    })
  );
  const [pendingJoinCall, setPendingJoinCall] = createSignal(wantsJoinCall);

  // Navigation flows into the surface as state; the messages part navigates
  // whenever a fresh request lands, whether or not it was mounted at the time.
  const [targetRequest, setTargetRequest] = createSignal<
    ChannelTargetRequest | undefined
  >(toChannelTargetRequest(initialTargetMessageParams()));
  let surfaceApi: ChannelSurfaceApi | undefined;

  const setActiveTab = (tab: ChannelTabId) => {
    setActiveTabInternal(normalizeChannelTab(tab));
  };

  const botManagement = useChannelBotManagement({
    channelId,
    hotkeyScopeId: splitPanel.splitHotkeyScope,
    openParticipants: () => setActiveTab('participants'),
  });

  // CallContext: which channel has the Call tab selected (for isCallPage(), etc.).
  // `createComputed` (not `createEffect`) so this runs before paint and matches
  // `activeTab` on the first frame (e.g. deep-link opens on Call tab).
  createComputed(() => {
    if (!callCtx) return;
    const tab = activeTab();
    callCtx.syncCallPageTab(channelId, tab === 'call');
  });

  // Nav away unmounts this block without switching tabs first — clear stale ownership.
  onCleanup(() => {
    if (!callCtx) return;
    callCtx.syncCallPageTab(channelId, false);
  });

  // Once the auto-join attempt settles — joined, failed, or calls disabled —
  // replace the URL so the deep link cannot fire a second time. This used to
  // wait for the call to mount, which left `join_call=true` in the URL forever
  // when the join failed; any later reload (the browser discarding this tab
  // overnight and restoring it on wake, say) then re-ran the join — and since
  // the join API is a get-or-create, that starts a brand-new call in the
  // channel. Retrying a failed join is the Call tab's "Try again", not a
  // refresh.
  createComputed(() => {
    if (pendingJoinCall()) return;
    if (searchParams[CHANNEL_URL_PARAMS.joinCall] === undefined) return;
    setSearchParams(
      { [CHANNEL_URL_PARAMS.joinCall]: undefined },
      { replace: true }
    );
  });

  // Register on the block always — `goToLocationFromParams` used to live only
  // inside `onChannelReady` (Messages tab), so open-call from Attachments/etc. was a no-op.
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: ChannelTargetMessageParams) => {
      // Store any message target first: a request that also opens the call tab
      // leaves it waiting for whenever the user returns to Messages.
      const target = toChannelTargetRequest(params);
      if (target) {
        setActiveTab(DEFAULT_CHANNEL_TAB);
        setTargetRequest(target);
      }

      if (isOpenCallTabRequested(params[CHANNEL_URL_PARAMS.openCallTab])) {
        setActiveTab(getCallJoinTab());
        return;
      }

      if (isJoinCallRequested(params[CHANNEL_URL_PARAMS.joinCall])) {
        setActiveTab(getCallJoinTab());
        setPendingJoinCall(true);
      }
    },
    goToLatest: async () => {
      setActiveTab(DEFAULT_CHANNEL_TAB);
      setTargetRequest({ kind: 'latest' });
    },
  });

  const disposeChannelStateCaptor = splitPanel.handle.registerEntryStateCaptor(
    CHANNEL_STATE_ENTRY_KEY,
    (): ChannelEntryStateSnapshot => ({
      activeTab: activeTab(),
      messages: surfaceApi?.getMessagesStateSnapshot(),
    })
  );
  onCleanup(disposeChannelStateCaptor);

  const initialMessagesStateSnapshot = () =>
    shouldHydratePersistedChannelState
      ? persistedChannelState?.messages
      : undefined;

  return (
    <ChannelSurface
      channelId={channelId}
      targetRequest={targetRequest()}
      initialMessagesState={initialMessagesStateSnapshot()}
      ref={(api) => {
        surfaceApi = api;
      }}
    >
      <CallEventSync />
      <ChannelTabProvider activeTab={activeTab} setActiveTab={setActiveTab}>
        <ChannelCallAutoJoin
          channelId={channelId}
          pendingJoinCall={pendingJoinCall}
          onHandled={() => setPendingJoinCall(false)}
        />
        <div
          class={cn(
            'h-full flex flex-col px-2 touch:px-0',
            // The channel block is full-frame on mobile (messages scroll
            // behind the chrome); the other tabs still need to start below
            // the status bar + floating header.
            activeTab() !== 'messages' &&
              'touch:pt-(--mobile-content-inset-top)'
          )}
        >
          <Switch>
            <Match when={activeTab() === 'messages'}>
              <ChannelMessages
                autofocus={canAutofocusSplitContent && !navigatedFromJK()}
              />
            </Match>
            <Match when={activeTab() === 'attachments'}>
              <ChannelAttachmentsTab channelId={channelId} />
            </Match>
            <Match when={activeTab() === 'calls' && ENABLE_CALLS}>
              <ChannelCallsTab channelId={channelId} />
            </Match>
            <Match when={activeTab() === 'participants'}>
              <ChannelParticipantsTab
                channelId={channelId}
                botManagementEnabled={botManagement.enabled()}
                onCreateBot={botManagement.openCreateBot}
                inviteBotFocusRequest={botManagement.inviteFocusRequest()}
                onOpenBot={botManagement.openBot}
              />
            </Match>
            <Match when={activeTab() === 'call' && canUseInlineCallTab()}>
              <ChannelCallTab
                channelId={channelId}
                pendingJoin={pendingJoinCall}
              />
            </Match>
          </Switch>
          <NewTop channelId={channelId} />
        </div>
      </ChannelTabProvider>
    </ChannelSurface>
  );
}
