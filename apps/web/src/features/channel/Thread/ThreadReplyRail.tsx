import { cn } from '@ui';
import { Show } from 'solid-js';

type ThreadReplyRailProps = {
  /** Grouped replies continue the spine without another avatar branch. */
  grouped?: boolean;
  /** An unread thread paints its complete rail path with the accent. */
  newMessage?: boolean;
};

/**
 * The rail geometry for one reply row. The spine remains on the parent
 * message's avatar column; an ungrouped reply branches from it and stops
 * short of the reply avatar.
 */
export function ThreadReplyRail(props: ThreadReplyRailProps) {
  const railClass = () =>
    cn(
      'pointer-events-none absolute -z-1 channel-rail-left border-rail',
      props.newMessage && 'border-accent'
    );
  const railLeft =
    'calc(var(--user-icon-width) / 2 + var(--message-padding-x) - var(--thread-shift) - var(--channel-rail-width) / 2)';

  return (
    <>
      <div class={cn(railClass(), 'inset-y-0')} style={{ left: railLeft }} />
      <Show when={!props.grouped}>
        <div
          class={cn(railClass(), 'top-0 channel-rail-bottom rounded-bl-[14px]')}
          style={{
            left: railLeft,
            width:
              'calc(var(--thread-shift) - var(--user-icon-width) / 2 - var(--channel-rail-clearance))',
            height:
              'calc(var(--regular-message-padding-t) + var(--user-icon-width) / 2)',
          }}
        />
      </Show>
    </>
  );
}
