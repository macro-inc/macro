import { useCallContextOptional } from '@channel/Call/CallContext';
import { getMeetingPath, getMeetingShareToken } from '@channel/Call/call-link';
import { joinChannelCall } from '@channel/Call/join-channel-call';
import { openChannelCallTab } from '@channel/Call/open-channel-call-tab';
import { DebugSuspense } from '@channel/DebugSuspense';
import { toast } from '@core/component/Toast/Toast';
import { ENABLE_CALLS } from '@core/constant/featureFlags';
import { useChannelsContext } from '@core/context/channels';
import { useUserId } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import { fireAndForget } from '@core/util/fireAndForget';
import { useActiveCallsQuery } from '@queries/call/call';
import { useNavigate } from '@solidjs/router';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type LiveCallRow,
  LiveCallsSidebar,
} from '../meetings/components/live-calls-sidebar';
import { useActiveQuickCallsSource } from '../meetings/queries/active-quick-calls';
import { useQuickCallsFlag } from '../meetings/use-quick-calls-flag';

type ChatLiveCall = LiveCallRow &
  ({ kind: 'channel'; channelId: string } | { kind: 'quick'; url: string });

async function selectChannelCall(call: { channelId: string; joined: boolean }) {
  if (call.joined) return openChannelCallTab(call.channelId);
  try {
    await joinChannelCall(call.channelId);
  } catch (error) {
    console.error('Failed to join call', error);
    toast.failure('Failed to join call');
  }
}

function ChatLiveCalls() {
  const userId = useUserId();
  const navigate = useNavigate();
  const callCtx = useCallContextOptional();
  const channelsCtx = useChannelsContext();
  const channelCalls = useActiveCallsQuery();
  const flag = useQuickCallsFlag();
  const quickCalls = useActiveQuickCallsSource(() =>
    !flag().loading && flag().enabled ? userId() : undefined
  );

  const joinedCallId = () =>
    callCtx?.isInCall() ? callCtx.activeCallId() : null;

  const calls = (): ChatLiveCall[] => {
    const quick = quickCalls.calls();
    const quickCallIds = new Set(quick.map((call) => call.callId));
    const channelsById = channelsCtx.channelsById();

    // A quick call is backed by a channel call; list it once, as the meeting.
    const channelRows = (channelCalls.data ?? []).flatMap(
      (call): ChatLiveCall[] => {
        const channel = channelsById[call.channelId];
        if (!channel || quickCallIds.has(call.callId)) return [];
        return [
          {
            kind: 'channel',
            id: call.callId,
            channelId: call.channelId,
            label: channel.name ?? 'Channel call',
            joined: joinedCallId() === call.callId,
          },
        ];
      }
    );
    const quickRows = quick.map(
      (call): ChatLiveCall => ({
        kind: 'quick',
        id: call.id,
        url: call.url,
        label: `Call with ${
          (call.createdBy && idToDisplayName(call.createdBy)) || 'someone'
        }`,
        joined: !!call.callId && joinedCallId() === call.callId,
      })
    );
    return [...channelRows, ...quickRows];
  };

  return (
    <LiveCallsSidebar
      calls={calls()}
      onSelect={(call) =>
        match(call)
          .with({ kind: 'channel' }, (channelCall) =>
            fireAndForget(selectChannelCall(channelCall), 'channel-call')
          )
          .with({ kind: 'quick' }, (quickCall) => {
            const token = getMeetingShareToken(quickCall.url);
            if (token) navigate(getMeetingPath(token));
          })
          .exhaustive()
      }
    />
  );
}

/** Live calls belong to the Chat workspace, outside its conversation tree. */
export function ChannelsLiveCallsSidebar() {
  return (
    <Show when={ENABLE_CALLS}>
      <DebugSuspense name="ChannelsView.live-calls">
        <ChatLiveCalls />
      </DebugSuspense>
    </Show>
  );
}
