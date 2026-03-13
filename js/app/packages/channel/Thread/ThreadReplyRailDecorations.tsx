import { cn } from '@ui/utils/classname';
import { type Accessor, Show } from 'solid-js';
import {
  getInnerRailBottom,
  innerRailTop,
  innerRailX,
  threadConnectorStyle,
} from './utils/thread-rail-geometry';

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
            height="100%"
          >
            <path
              stroke="currentColor"
              vector-effect="non-scaling-stroke"
              d="M0 0.5 24 17.5"
            />
          </svg>
        </div>
      </div>
      {/* THIS IS A HACKY ELEMENT POSITIONED TO BLOCK THE STUB END OF THE RAIL THAT POKE UP ABOVE THE USER ICON */}
      <div class="pointer-events-none absolute bg-panel left-[calc(var(--left-of-connector)+var(--thread-shift))] top-0 min-h-[var(--message-padding)] min-w-4 -translate-x-1/2 z-1" />
      <Show when={props.isReplying()}>
        <div
          class="pointer-events-none absolute bottom-0 -z-1 border-l border-[blue]"
          style={{
            left: innerRailX,
            top: innerRailTop,
            bottom: getInnerRailBottom(props.isReplying()),
          }}
        />
      </Show>
    </>
  );
}
