import { useBlockEntityCommands } from '@app/component/next-soup/actions';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import { SplitHeaderRight } from '@app/component/split-layout/components/SplitHeader';
import { globalSplitManager } from '@app/signal/splitLayout';
import { URL_PARAMS } from '@block-channel/constants';
import { ChannelAttachmentsTab } from '@channel/Attachments/ChannelAttachmentsTab';
import {
  CallEventSync,
  ChannelCallAutoJoin,
  ChannelCallButton,
  ChannelCallTab,
  getCallJoinTab,
  isNativeIosCallKitEnabled,
  useCall,
  useCallContextOptional,
} from '@channel/Call';
import {
  type ChannelHandle,
  type ChannelProps,
  Channel as NewChannel,
} from '@channel/Channel/Channel';
import {
  ChannelTabProvider,
  useChannelTab,
} from '@channel/Channel/ChannelTabContext';
import { ChannelTopBarLiveIndicators } from '@channel/Channel/ChannelTopBarLiveIndicators';
import {
  CHANNEL_TABS,
  type ChannelTabId,
  DEFAULT_CHANNEL_TAB,
} from '@channel/Channel/channel-tabs';
import {
  URL_PARAMS as CHANNEL_URL_PARAMS,
  isJoinCallRequested,
  isOpenCallTabRequested,
} from '@channel/Channel/link';
import { ChannelParticipantsTab } from '@channel/Participants/ChannelParticipantsTab';
import { useBlockId } from '@core/block';
import { EntityPermissionsGate } from '@core/component/EntityPermissionsGate';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useChannelName, useChannelType } from '@core/context/channels';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { useActiveCallQuery } from '@queries/call/call';
import { useChannelParticipantsQuery } from '@queries/channel/channel-participants';
import { ChannelTypeEnum } from '@service-storage/client';
import { useSearchParams } from '@solidjs/router';
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

type ChannelTargetMessageParams = {
  [URL_PARAMS.message]?: string;
  [URL_PARAMS.thread]?: string;
  [CHANNEL_URL_PARAMS.joinCall]?: string;
  [CHANNEL_URL_PARAMS.openCallTab]?: string;
};

export type BlockChannelProps = ChannelTargetMessageParams;

type ChannelPropsTargetMessage = Pick<
  ChannelProps,
  'targetMessageId' | 'targetMessageReplyId'
>;

function CallTabLabel() {
  return (
    <span class="flex items-center gap-1.5">
      <span class="size-1.5 rounded-full bg-success animate-pulse" />
      Call
    </span>
  );
}

const canUseInlineCallTab = () => {
  return !isNativeIosCallKitEnabled();
};

// Native iOS CallKit owns the call surface, so the embedded Call tab should
// never become the active channel tab on that platform.
const normalizeChannelTab = (tab: ChannelTabId) => {
  return tab === 'call' && canUseInlineCallTab() ? tab : DEFAULT_CHANNEL_TAB;
};

const initialChannelTab = (options: {
  wantsJoinCall: boolean;
  hasActiveCallHere: boolean;
}) => {
  return normalizeChannelTab(
    options.wantsJoinCall || options.hasActiveCallHere
      ? 'call'
      : DEFAULT_CHANNEL_TAB
  );
};

function NewTop(props: { channelId: string }) {
  const { activeTab, setActiveTab } = useChannelTab();
  const channelName = useChannelName(props.channelId);
  const channelType = useChannelType(props.channelId);
  const participantsQuery = useChannelParticipantsQuery(() => props.channelId);
  const call = useCall(() => props.channelId);
  const activeCallQuery = useActiveCallQuery(() => props.channelId);
  const participants = () =>
    participantsQuery.isLoading ? [] : participantsQuery.data;
  // Show the Call tab whenever we're actually in the call, mid-join, or
  // the tab is being displayed (e.g. via the auto-join flow that flips
  // `activeTab` to `call` before the join request resolves).
  const showCallTab = () =>
    ENABLE_CALLS() &&
    canUseInlineCallTab() &&
    (call.isInThisChannel() ||
      call.isJoining() ||
      activeTab() === 'call' ||
      !!activeCallQuery.data);
  const tabs = () => {
    let filtered = [...CHANNEL_TABS];
    if (channelType() === ChannelTypeEnum.DirectMessage)
      filtered = filtered.filter((tab) => tab.value !== 'participants');
    if (!showCallTab())
      filtered = filtered.filter((tab) => tab.value !== 'call');
    return filtered.map((tab) =>
      tab.value === 'call' ? { ...tab, label: <CallTabLabel /> } : tab
    );
  };

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
      <Show when={ENABLE_CALLS()}>
        <SplitHeaderRight>
          <div class="flex items-center gap-1.5">
            <ChannelCallButton channelId={props.channelId} />
          </div>
        </SplitHeaderRight>
      </Show>
      <ChannelTopBarLiveIndicators />
    </Suspense>
  );
}

export function NewChannelBlockAdapter(props: BlockChannelProps) {
  useBlockEntityCommands();

  const isPreview = !!useMaybePreviewPanel();
  const channelId = useBlockId();
  const blockHandle = blockHandleSignal.get;
  const [searchParams, setSearchParams] = useSearchParams();

  // Decide whether the user asked to auto-join the call (via ?join_call=true
  // deep link or programmatic open props) before creating signals so we
  // can land directly on the Call tab without flashing Messages first.
  // Skipped inside a preview panel so hover-previews don't auto-join.
  const wantsJoinCall =
    !isPreview &&
    (isJoinCallRequested(props[CHANNEL_URL_PARAMS.joinCall]) ||
      isJoinCallRequested(searchParams[CHANNEL_URL_PARAMS.joinCall]));

  const callCtx = useCallContextOptional();
  const hasActiveCallHere = !!(
    callCtx?.isInCall() && callCtx.activeChannelId() === channelId
  );

  const [activeTab, setActiveTabInternal] = createSignal<ChannelTabId>(
    initialChannelTab({ wantsJoinCall, hasActiveCallHere })
  );
  const [pendingJoinCall, setPendingJoinCall] = createSignal(wantsJoinCall);

  /** Set when `<NewChannel>` mounts (Messages tab only); used for goToMessage. */
  const messagesChannelHandle: { current?: ChannelHandle } = {};

  const setActiveTab = (tab: ChannelTabId) => {
    tab = normalizeChannelTab(tab);
    if (tab !== 'messages') {
      messagesChannelHandle.current = undefined;
    }
    setActiveTabInternal(tab);
  };

  // CallContext: which channel has the Call tab selected (for isCallPage(), etc.).
  // `createComputed` (not `createEffect`) so this runs before paint and matches
  // `activeTab` on the first frame (e.g. deep-link opens on Call tab).
  createComputed(() => {
    if (isPreview || !callCtx) return;
    const tab = activeTab();
    callCtx.syncCallPageTab(channelId, tab === 'call');
  });

  // Nav away unmounts this block without switching tabs first — clear stale ownership.
  onCleanup(() => {
    if (isPreview || !callCtx) return;
    callCtx.syncCallPageTab(channelId, false);
  });

  // Once the call actually mounts for this channel, replace the URL so a
  // reload doesn't re-trigger auto-join after the user has left. Waiting for
  // the call to mount (instead of running on adapter mount) preserves the
  // deep link if the join fails so the user can retry by refreshing.
  createComputed(() => {
    if (!callCtx) return;
    if (!callCtx.isInCall() || callCtx.activeChannelId() !== channelId) return;
    if (searchParams[CHANNEL_URL_PARAMS.joinCall] === undefined) return;
    setSearchParams(
      { [CHANNEL_URL_PARAMS.joinCall]: undefined },
      { replace: true }
    );
  });

  const convertTargetMessage = (
    params: ChannelTargetMessageParams
  ): ChannelPropsTargetMessage => {
    const messageId = params[URL_PARAMS.message] as string | undefined;
    const threadId = params[URL_PARAMS.thread] as string | undefined;

    // For compatibility the naming is a little strange here.
    // New channels index by top level message and then separately handle replies.
    // If we have a threadId that is actually the top level message and the reply is the message id.
    const topLevelMessageId = threadId ? threadId : messageId;
    const messageReplyId = threadId ? messageId : threadId;

    return {
      targetMessageId: topLevelMessageId,
      targetMessageReplyId: messageReplyId,
    };
  };

  // Register on the block always — `goToLocationFromParams` used to live only
  // inside `onChannelReady` (Messages tab), so open-call from Attachments/etc. was a no-op.
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: ChannelTargetMessageParams) => {
      if (isOpenCallTabRequested(params[CHANNEL_URL_PARAMS.openCallTab])) {
        setActiveTab(getCallJoinTab());
        return;
      }

      const { targetMessageId, targetMessageReplyId } =
        convertTargetMessage(params);

      if (targetMessageId && messagesChannelHandle.current) {
        setActiveTab(DEFAULT_CHANNEL_TAB);
        messagesChannelHandle.current.goToMessage(
          targetMessageId,
          targetMessageReplyId
        );
      }

      if (isJoinCallRequested(params[CHANNEL_URL_PARAMS.joinCall])) {
        setActiveTab(getCallJoinTab());
        setPendingJoinCall(true);
      }
    },
  });

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

  const onChannelReady = (handle: ChannelHandle) => {
    messagesChannelHandle.current = handle;
  };

  return (
    <EntityPermissionsGate entityType="channel" entityId={channelId}>
      <CallEventSync />
      <ChannelTabProvider activeTab={activeTab} setActiveTab={setActiveTab}>
        <ChannelCallAutoJoin
          channelId={channelId}
          pendingJoinCall={pendingJoinCall}
          onHandled={() => setPendingJoinCall(false)}
        />
        <div class="h-full flex flex-col px-2 mobile:px-0">
          <Switch>
            <Match when={activeTab() === 'messages'}>
              <NewChannel
                channelId={channelId}
                onHandleReady={onChannelReady}
                autofocus={!isPreview}
                {...convertTargetMessage(initialTargetMessageParams())}
              />
            </Match>
            <Match when={activeTab() === 'attachments'}>
              <ChannelAttachmentsTab channelId={channelId} />
            </Match>
            <Match when={activeTab() === 'participants'}>
              <ChannelParticipantsTab channelId={channelId} />
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
    </EntityPermissionsGate>
  );
}
