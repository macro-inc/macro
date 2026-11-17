import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import type { ParentProps } from 'solid-js';

/**
 * A new email beside the list on wide touch: the composer's own header, as
 * the phone composer has, in the pane's top bar.
 */
export function MobileEmailComposeRoute(props: ParentProps) {
  return (
    <SplitHeaderScope.Root>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <SplitHeaderScope.TopBar />
        <div class="relative min-h-0 min-w-0 flex-1">{props.children}</div>
      </div>
    </SplitHeaderScope.Root>
  );
}
