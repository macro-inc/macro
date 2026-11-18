import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import type { ParentProps } from 'solid-js';

/**
 * A task in touch Tasks: the task's own mobile header, as a standalone task
 * has, in the pane's top bar.
 */
export function MobileTaskDetailPane(props: ParentProps) {
  return (
    <SplitHeaderScope.Root>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <SplitHeaderScope.TopBar />
        <div class="relative min-h-0 min-w-0 flex-1">{props.children}</div>
      </div>
    </SplitHeaderScope.Root>
  );
}
