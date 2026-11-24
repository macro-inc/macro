import type { EntityDetailNavigationOptions } from '@app/components/entity-detail/entity-detail-target';
import { useInlinePreviewLayout } from '@app/components/view-shell/use-inline-preview-layout';
import { useNavigate } from '@app/lib/split-router';
import { projectTaskRoute } from '@app/routes/routes';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ProjectSection } from './core/project';

/** Where a task opened from a project can go. */
export type ProjectTaskOpener = {
  /** The pane shows details in place: desktop, and a tablet's wide pane. */
  inline: boolean;
  /** Shows the task beside the project, in the project's own pane. */
  showInProject(taskId: string): void;
  openInSplit(
    content: SplitContent,
    options: { preferNewSplit?: boolean }
  ): void;
};

/**
 * Opens a task from a project's list or Time tab. Where the pane shows details
 * in place (desktop, and a tablet's wide pane) a plain click or tap shows it
 * in the project's pane; a phone or narrow pane, and a modifier key, open it
 * as a task in a split, a new one with Shift.
 */
export function openProjectTask(
  taskId: string,
  options: EntityDetailNavigationOptions | undefined,
  opener: ProjectTaskOpener
): true {
  const event = options?.event;
  const modified =
    event?.shiftKey || event?.metaKey || event?.ctrlKey || event?.altKey;
  if (opener.inline && !modified) {
    opener.showInProject(taskId);
    return true;
  }
  opener.openInSplit(
    { type: 'task', id: taskId },
    { preferNewSplit: event?.shiftKey }
  );
  return true;
}

/** Opens a project's tasks from its pane, as `openProjectTask` decides. */
export function useOpenProjectTask(props: {
  projectId: () => string;
  section: () => ProjectSection;
}) {
  const navigate = useNavigate();
  const layout = useSplitLayout();
  const inline = useInlinePreviewLayout();
  return (taskId: string, options?: EntityDetailNavigationOptions): true =>
    openProjectTask(taskId, options, {
      inline: inline(),
      showInProject: (id) =>
        fireAndForget(
          navigate({
            route: projectTaskRoute,
            params: {
              projectId: props.projectId(),
              section: props.section(),
              taskId: id,
            },
          }),
          'project-detail'
        ),
      openInSplit: (content, splitOptions) =>
        layout.openWithSplit(content, splitOptions),
    });
}
