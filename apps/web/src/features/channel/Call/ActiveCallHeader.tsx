import { useActiveCallQuery } from '@queries/call/call';
import { Show } from 'solid-js';
import { ActiveCallLink } from './ActiveCallLink';
import { CallLiveChip } from './CallLiveChip';

/** The channel owns its header; the call adds only its live state and link. */
export function ActiveCallHeader(props: { channelId: string; link?: boolean }) {
  const active = useActiveCallQuery(() => props.channelId);
  return (
    <>
      <CallLiveChip
        startedAt={active.isSuccess ? active.data?.createdAt : undefined}
      />
      <Show when={props.link}>
        <ActiveCallLink compact />
      </Show>
    </>
  );
}
