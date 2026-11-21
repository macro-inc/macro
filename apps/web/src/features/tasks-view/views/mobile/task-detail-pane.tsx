import { SplitHeaderScope } from '@components/app/SplitHeaderScope';
import type { ParentProps } from 'solid-js';

/**
 * A task in touch Tasks: the task's own mobile header, as a standalone task
 * has, in the pane's top bar.
 */
export function MobileTaskDetailPane(props: ParentProps) {
  return <SplitHeaderScope.Pane>{props.children}</SplitHeaderScope.Pane>;
}
