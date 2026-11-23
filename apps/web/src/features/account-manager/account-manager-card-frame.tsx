import type { ParentProps } from 'solid-js';

/**
 * The card's box, the same height in every state. Channels are a virtualized
 * list, so a message that grows after mounting would jump the scroll position.
 */
export function AccountManagerCardFrame(props: ParentProps) {
  return (
    <span class="my-1 flex h-[4.5rem] max-w-md flex-col justify-center gap-1.5 rounded-lg border border-edge-muted bg-panel px-3">
      {props.children}
    </span>
  );
}
