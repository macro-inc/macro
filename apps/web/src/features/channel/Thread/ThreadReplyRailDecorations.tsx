import { cn } from '@ui/utils/classname';
import type { Accessor } from 'solid-js';
import { threadConnectorStyle } from './utils/thread-rail-geometry';

type ThreadReplyRailProps = {
  isReplying: Accessor<boolean>;
  firstThreadReplyNewMessage?: boolean;
};

export function ThreadReplyRailDecorations(props: ThreadReplyRailProps) {
  return (
    <>
      {/* Branch elbow: continues the root message's rail segment and stops
          short of the first reply's avatar by the shared rail clearance. */}
      <div
        class={cn(
          'pointer-events-none absolute top-0 -z-1 channel-rail-left channel-rail-bottom border-rail rounded-bl-[14px]',
          props.firstThreadReplyNewMessage && 'border-accent'
        )}
        style={{
          left: threadConnectorStyle.left,
          width: threadConnectorStyle.width,
          height:
            'calc(var(--thread-padding-y) + var(--regular-message-padding-t) + var(--user-icon-width) / 2)',
        }}
      />
      {/* Blocks the stub of the first reply's inner rail that pokes up above
          its avatar. */}
      <div class="pointer-events-none absolute bg-surface left-[calc(var(--left-of-connector)+var(--thread-shift))] top-(--regular-message-padding-t) min-h-(--message-padding-x) min-w-4 -translate-x-1/2 z-0" />
    </>
  );
}
