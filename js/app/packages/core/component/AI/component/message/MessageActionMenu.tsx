import Copy from '@phosphor-icons/core/regular/copy.svg?component-solid';
import Pencil from '@phosphor-icons/core/regular/pencil.svg?component-solid';

import { type Accessor, Show } from 'solid-js';

export function MessageActionMenu(props: {
  isLastmessage: Accessor<boolean>;
  onCopy: () => void;
  onEdit: () => void;
}) {
  return (
    <div class="flex items-center gap-1">
      <Show when={props.isLastmessage()}>
        <div
          class="rounded-full hover:bg-hover hover-transition-bg p-1 text-ink-muted"
          onClick={props.onEdit}
        >
          <Pencil class="w-5 h-5" />
        </div>
      </Show>
      <div
        class="rounded-full hover:bg-hover hover-transition-bg p-1 text-ink-muted"
        onClick={props.onCopy}
      >
        <Copy class="w-5 h-5" />
      </div>
    </div>
  );
}
