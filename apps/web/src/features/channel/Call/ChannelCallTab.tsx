import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { UserGroup } from '@core/component/UserGroup';
import { useChannel } from '@core/context/channels';
import { isMobile } from '@core/mobile/isMobile';
import { getDisplayName, tryMacroId } from '@core/user';
import PhoneIcon from '@icon/system/regular/phone.svg';
import { Telemetry } from '@macro-inc/observability';
import { useActiveCallQuery, useLiveCallRecordQuery } from '@queries/call/call';
import { Button } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { CallOverlay } from './CallOverlay';
import { getCallJoinTab, getCallLeaveTab } from './call-tabs';
import { CallDiscussionContent } from './discussion/CallDiscussionContent';
import { callDiscussionOf } from './discussion/call-discussion';
import { useCall } from './use-call';
import { ActiveCallHeader } from './views/ActiveCallHeader';

function ParticipantFirstName(props: { id: string }) {
  const name = createMemo(() => {
    const fullName = getDisplayName(tryMacroId(props.id));
    return fullName.trim().split(/\s+/)[0] || fullName || 'Someone';
  });

  return <>{name()}</>;
}

function ParticipantNamesLine(props: { ids: string[] }) {
  const count = () => props.ids.length;
  const remaining = () => Math.max(0, count() - 2);

  return (
    <Show when={count() > 0}>
      <p class="max-w-sm text-sm text-ink-muted">
        <Show when={count() === 1}>
          <ParticipantFirstName id={props.ids[0]} /> is in this call.
        </Show>
        <Show when={count() === 2}>
          <ParticipantFirstName id={props.ids[0]} /> and{' '}
          <ParticipantFirstName id={props.ids[1]} /> are in this call.
        </Show>
        <Show when={count() > 2}>
          <ParticipantFirstName id={props.ids[0]} />,{' '}
          <ParticipantFirstName id={props.ids[1]} />, and {remaining()} other
          {remaining() === 1 ? '' : 's'} are in this call.
        </Show>
      </p>
    </Show>
  );
}

function JoinCallEmptyState(props: {
  channelId: string;
  isJoining: boolean;
  onJoin: () => void;
}) {
  const activeCallQuery = useActiveCallQuery(() => props.channelId);
  const callRecordQuery = useLiveCallRecordQuery(
    () => activeCallQuery.data?.callId ?? ''
  );
  const participantIds = createMemo(
    () =>
      callRecordQuery.data?.participants
        .filter((participant) => !participant.leftAt)
        .map((participant) => participant.userId) ?? []
  );

  return (
    <div class="flex size-full flex-col items-center justify-center gap-5 px-6 text-center text-ink">
      <div class="flex flex-col items-center gap-3">
        <UserGroup
          userIds={participantIds()}
          maxUsers={5}
          size="lg"
          suppressClick
          showTooltip
        />
        <div class="flex flex-col items-center gap-1">
          <h2 class="text-lg font-semibold">Call in progress</h2>
          <ParticipantNamesLine ids={participantIds()} />
        </div>
      </div>

      <Button
        variant="primary"
        size="lg"
        class="px-5"
        onClick={props.onJoin}
        disabled={props.isJoining}
      >
        <PhoneIcon class="size-5" />
        {props.isJoining ? 'Connecting...' : 'Join call'}
      </Button>
    </div>
  );
}

export function ChannelCallTab(props: {
  channelId: string;
  /**
   * When true, show a "Joining call…" placeholder if we aren't yet
   * connected to this channel's call. Used for auto-join flows (e.g.
   * `?join_call=true` deep links) so the tab can render meaningful
   * content before the join request lands.
   */
  pendingJoin?: Accessor<boolean>;
}) {
  const { setActiveTab } = useChannelTab();
  let leaving = false;

  // Match ChannelCallButton / ChannelCallAutoJoin so leaving from the
  // overlay (or disconnect) switches back to Messages — not only when
  // the join was initiated from the header button.
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
    onLeave: () => setActiveTab(getCallLeaveTab()),
  });

  const record = useLiveCallRecordQuery(
    () => call.callCtx.activeCallId() ?? ''
  );
  const discussion = () =>
    callDiscussionOf(record, call.callCtx.activeCallId());
  const channel = useChannel(props.channelId);
  const [outsideCount, setOutsideCount] = createSignal(0);

  async function handleJoin() {
    try {
      await call.joinCall();
    } catch (error) {
      console.error('Failed to join call', error);
    }
  }

  // Leaving keeps the user in this channel (onLeave switches to Messages),
  // even when their hangup ends the call.
  async function handleLeave() {
    if (leaving) return;
    leaving = true;
    const callId = call.callCtx.activeCallId();
    try {
      await Telemetry.span('call.leave', async (span) => {
        if (callId) span.setAttr('call.id', callId);
        const result = await call.leaveCall();
        span.setAttr('call.leave.ended', result?.callEnded ?? false);
      });
    } finally {
      leaving = false;
    }
  }

  return (
    <Switch
      fallback={
        <JoinCallEmptyState
          channelId={props.channelId}
          isJoining={call.isJoining()}
          onJoin={handleJoin}
        />
      }
    >
      <Match when={call.isInThisChannel() && !call.joinError()}>
        <div class="size-full min-h-0">
          <Show when={isMobile()}>
            <SplitHeaderRight>
              <ActiveCallHeader channelId={props.channelId} />
            </SplitHeaderRight>
          </Show>
          <CallOverlay
            onLeave={handleLeave}
            sharingChannelName={
              discussion()?.kind === 'channel_thread'
                ? (channel()?.name ?? undefined)
                : undefined
            }
            discussion={{
              label: () =>
                discussion()?.kind === 'channel_thread'
                  ? (channel()?.name ?? undefined)
                  : undefined,
              opensByDefault: () =>
                !isMobile() && discussion()?.kind === 'channel_thread',
              hasUpdates: () => outsideCount() > 0,
              render: (panel) => (
                <CallDiscussionContent
                  discussion={discussion}
                  panel={panel}
                  onViewChannel={() => setActiveTab('messages')}
                  onOutsideCountChange={setOutsideCount}
                />
              ),
            }}
          />
        </div>
      </Match>
      <Match when={call.joinError()}>
        <div class="flex size-full flex-col items-center justify-center gap-3 text-ink-muted px-4">
          <p class="text-center">{call.joinError()}</p>
          <Show when={call.isJoining()}>
            <p class="text-xs text-ink-extra-muted animate-pulse">
              Connecting…
            </p>
          </Show>
          <button
            type="button"
            onClick={handleJoin}
            disabled={call.isJoining()}
            class="rounded-lg bg-surface-2 px-4 py-2 text-sm text-ink hover:bg-surface-3 transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            Try again
          </button>
        </div>
      </Match>
      <Match when={props.pendingJoin?.()}>
        <div class="flex size-full items-center justify-center text-ink-muted">
          Joining call...
        </div>
      </Match>
    </Switch>
  );
}
