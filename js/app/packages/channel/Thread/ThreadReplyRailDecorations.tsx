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
      <div class="pointer-events-none absolute" style={threadConnectorStyle}>
        <div
          class={cn(
            'absolute text-edge-muted -z-1 w-full h-full',
            props.firstThreadReplyNewMessage && 'text-accent'
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 18"
            width="100%"
          >
            <path
              stroke="currentColor"
              vector-effect="non-scaling-stroke"
              d="M23 17 4 6.0303C2.5 5.1643.5 4 .5.5"
            />
          </svg>
        </div>
      </div>
      {/* THIS IS A HACKY ELEMENT POSITIONED TO BLOCK THE STUB END OF THE RAIL THAT POKE UP ABOVE THE USER ICON */}
      <div class="pointer-events-none absolute bg-panel left-[calc(var(--left-of-connector)+var(--thread-shift))] top-(--regular-message-padding-t) min-h-[var(--message-padding-x)] min-w-4 -translate-x-1/2 z-0" />
    </>
  );
}
