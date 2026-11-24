import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import type { SplitContent } from '@components/app/split-layout/layoutManager';

/** Where a task opened from a project can go. */
export type ProjectTaskOpener = {
  touch: boolean;
  /** Shows the task beside the project, in the project's own pane. */
  showInProject(taskId: string): void;
  openInSplit(
    content: SplitContent,
    options: { preferNewSplit?: boolean }
  ): void;
};

/**
 * Opens a task from a project's list or Time tab. On desktop a plain click
 * shows it beside the project; touch and a modifier key open it as a task in
 * a split, a new one with Shift.
 */
export function openProjectTask(
  taskId: string,
  options: EntityDetailNavigationOptions | undefined,
  opener: ProjectTaskOpener
): true {
  const event = options?.event;
  const modified =
    event?.shiftKey || event?.metaKey || event?.ctrlKey || event?.altKey;
  if (!opener.touch && !modified) {
    opener.showInProject(taskId);
    return true;
  }
  opener.openInSplit(
    { type: 'task', id: taskId },
    { preferNewSplit: event?.shiftKey }
  );
  return true;
}
