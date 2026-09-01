import { cn } from '@ui';
import { Show } from 'solid-js';

type ThreadReplyRailProps = {
  /** Grouped replies continue the spine without another avatar branch. */
  grouped?: boolean;
  /** Stop at this row's avatar branch instead of continuing through the row. */
  terminal?: boolean;
};

/**
 * The rail geometry for one reply row. The spine remains on the parent
 * message's avatar column; an ungrouped reply branches from it and stops
 * short of the reply avatar.
 */
export function ThreadReplyRail(props: ThreadReplyRailProps) {
  const railClass =
    'pointer-events-none absolute -z-1 channel-rail-left border-thread-rail';
  const railLeft =
    'calc(var(--user-icon-width) / 2 + var(--message-padding-x) - var(--thread-shift) - var(--channel-rail-width) / 2)';

  return (
    <>
      <Show when={!props.terminal}>
        <div class={cn(railClass, 'inset-y-0')} style={{ left: railLeft }} />
      </Show>
      <Show when={!props.grouped}>
        <div
          class={cn(railClass, 'top-0 channel-rail-bottom rounded-bl-[14px]')}
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
