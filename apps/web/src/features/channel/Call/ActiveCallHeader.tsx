import { UserGroup } from '@core/component/UserGroup';
import { useActiveCallQuery, useLiveCallRecordQuery } from '@queries/call/call';
import { Show } from 'solid-js';
import { ActiveCallLink } from './ActiveCallLink';
import { CallLiveChip } from './CallLiveChip';

/** The channel owns its header; the call adds only its live state and link. */
export function ActiveCallHeader(props: { channelId: string; link?: boolean }) {
  const active = useActiveCallQuery(() => props.channelId);
  return (
    <>
      <CallLiveChip
        channelId={props.channelId}
        startedAt={active.isSuccess ? active.data?.createdAt : undefined}
      />
      <Show when={props.link}>
        <ActiveCallLink compact />
      </Show>
    </>
  );
}

export function JoinableCallStatus(props: { channelId: string }) {
  const active = useActiveCallQuery(() => props.channelId);
  const record = useLiveCallRecordQuery(() =>
    active.isSuccess ? (active.data?.callId ?? '') : ''
  );
  const participants = () =>
    record.isSuccess
      ? record.data.participants
          .filter((person) => !person.leftAt)
          .map((person) => person.userId)
      : [];
  return (
    <Show when={active.isSuccess && active.data}>
      <UserGroup
        userIds={participants()}
        size="sm"
        maxUsers={4}
        suppressClick
      />
      <CallLiveChip
        channelId={props.channelId}
        bare
        startedAt={active.isSuccess ? active.data?.createdAt : undefined}
      />
    </Show>
  );
}
