import { useCallContextOptional } from '@channel/Call/CallContext';
import { CallLiveChip } from '@channel/Call/CallLiveChip';
import { UserGroup } from '@core/component/UserGroup';
import { useUserId } from '@core/context/user';
import { tryMacroId } from '@core/user';
import { useActiveCallsQuery } from '@queries/call/call';
import { Show } from 'solid-js';

/** Only mounted for a live row; shares the app's existing active-call query. */
export function ChannelLiveCallBadge(props: { channelId: string }) {
  const active = useActiveCallsQuery();
  const call = useCallContextOptional();
  const userId = useUserId();
  const joined = () =>
    call?.isInCall() && call.activeChannelId() === props.channelId;
  const summary = () =>
    active.isSuccess
      ? active.data.find((item) => item.channelId === props.channelId)
      : undefined;
  const participants = () => {
    if (!joined() || !call) return [];
    const local = userId();
    const remote = Array.from(call.remoteParticipants().values())
      .filter((participant) => !participant.isAgent)
      .flatMap((participant) => {
        const id = tryMacroId(participant.identity);
        return id ? [id] : [];
      });
    return local ? [local, ...remote] : remote;
  };
  return (
    <span class="flex shrink-0 items-center gap-1.5">
      <Show when={joined()}>
        <UserGroup
          userIds={participants()}
          maxUsers={3}
          size="sm"
          suppressClick
        />
      </Show>
      <CallLiveChip
        channelId={props.channelId}
        bare
        hideWave={joined()}
        startedAt={summary()?.createdAt}
      />
    </span>
  );
}
