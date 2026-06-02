import { useChannelTab } from '@channel/Channel/ChannelTabContext';
import { DEFAULT_CHANNEL_TAB } from '@channel/Channel/channel-tabs';
import { UserGroup } from '@core/component/UserGroup';
import { tryMacroId, useDisplayNameParts } from '@core/user';
import PhoneIcon from '@icon/wide-call.svg';
import { useActiveCallQuery, useCallRecordQuery } from '@queries/call/call';
import { Button } from '@ui';
import { type Accessor, createMemo, Match, Show, Switch } from 'solid-js';
import { CallOverlay } from './CallOverlay';
import { useCall } from './use-call';

function ParticipantFirstName(props: { id: string }) {
  const nameParts = useDisplayNameParts(tryMacroId(props.id));
  const name = createMemo(
    () => nameParts.firstName() || nameParts.fullName() || 'Someone'
  );

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
        class="rounded-lg px-5"
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

  // Match ChannelCallButton / ChannelCallAutoJoin so leaving from the
  // overlay (or disconnect) switches back to Messages — not only when
  // the join was initiated from the header button.
  const call = useCall(() => props.channelId, {
    onJoin: () => setActiveTab('call'),
    onLeave: () => setActiveTab(DEFAULT_CHANNEL_TAB),
  });

  const handleRetry = async () => {
    try {
      await call.joinCall();
    } catch {
      // joinError is set inside useCall join mutation onError
    }
  };

  return (
    <Switch
      fallback={
        <JoinCallEmptyState
          channelId={props.channelId}
          isJoining={call.isJoining()}
          onJoin={() => void call.joinCall()}
        />
      }
    >
      <Match when={call.isInThisChannel() && !call.joinError()}>
        <CallOverlay onLeave={call.leaveCall} />
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
            onClick={handleRetry}
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
