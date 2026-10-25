import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { UserGroup } from '@core/component/UserGroup';
import { getDisplayName, tryMacroId } from '@core/user';
import { Telemetry } from '@macro-inc/observability';
import PhoneIcon from '@phosphor/phone-call.svg';
import { useActiveCallQuery, useCallRecordQuery } from '@queries/call/call';
import { useLocation, useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { type Accessor, createMemo, Match, Show, Switch } from 'solid-js';
import { ActiveCallLink } from './ActiveCallLink';
import { CallOverlay } from './CallOverlay';
import { getCallExitPath } from './call-exit';
import { getCallJoinTab, getCallLeaveTab } from './call-tabs';
import { useCall } from './use-call';

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
  const callRecordQuery = useCallRecordQuery(
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
        variant="cta"
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
  const navigate = useNavigate();
  const location = useLocation();
  let leaving = false;

  // Match ChannelCallButton / ChannelCallAutoJoin so leaving from the
  // overlay (or disconnect) switches back to Messages — not only when
  // the join was initiated from the header button.
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab(getCallJoinTab()),
    onLeave: () => setActiveTab(getCallLeaveTab()),
  });

  async function handleJoin() {
    try {
      await call.joinCall();
    } catch (error) {
      console.error('Failed to join call', error);
    }
  }

  async function handleLeave() {
    if (leaving) return;
    leaving = true;
    const callId = call.callCtx.activeCallId();
    const channelId = props.channelId;
    const from = location.key;
    try {
      await Telemetry.span('call.leave', async (span) => {
        if (callId) span.setAttr('call.id', callId);
        const result = await call.leaveCall();
        span.setAttr('call.leave.ended', result?.callEnded ?? false);
        if (
          props.channelId !== channelId ||
          location.key !== from ||
          call.callCtx.isInCall() ||
          !result?.callEnded
        )
          return;
        // Leaving switches to Messages and unmounts this tab before cleanup
        // settles. The route key keeps that expected teardown distinct from
        // the user navigating elsewhere while the server responds.
        navigate(
          getCallExitPath({
            authenticated: true,
            callId,
            channelId,
            callEnded: true,
          })
        );
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
        <div class="flex size-full min-h-0 flex-col">
          <div class="px-2 pt-2">
            <ActiveCallLink />
          </div>
          <div class="min-h-0 flex-1">
            <CallOverlay onLeave={handleLeave} />
          </div>
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
