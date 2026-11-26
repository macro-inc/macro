import { Card } from '@ui';
import type { ParentProps } from 'solid-js';

/**
 * The card's box, the same height in every state. Channels are a virtualized
 * list, so a message that grows after mounting would jump the scroll position.
 */
export function AccountManagerCardFrame(props: ParentProps) {
  return (
    <Card
      variant="raised"
      class="my-1 h-[4.5rem] max-w-md justify-center gap-1.5 px-3"
    >
      {props.children}
    </Card>
  );
}
