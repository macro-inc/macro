import { TagEditorDialog } from '@app/features/property/tags/TagEditorDialog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { createSignal } from 'solid-js';
import { TasksCreateMenu } from './components/TasksCreateMenu';

/** Task and project composers plus the shared tag editor, owned by this view. */
export function TasksCreateAction(props: {
  presentation: 'sidebar' | 'toolbar';
  projectsEnabled: boolean;
}) {
  const layout = useSplitLayout();
  const team = useCurrentTeamQuery();
  const [creatingTag, setCreatingTag] = createSignal(false);

  return (
    <>
      <TasksCreateMenu
        presentation={props.presentation}
        onCreateTask={() =>
          layout.popoverSplit({ type: 'component', id: 'task-compose' })
        }
        onCreateProject={
          props.projectsEnabled
            ? () =>
                layout.popoverSplit({
                  type: 'component',
                  id: 'project-compose',
                })
            : undefined
        }
        onCreateTag={() => setCreatingTag(true)}
      />
      <TagEditorDialog
        open={creatingTag()}
        mode={{ type: 'create', initialScope: 'user' }}
        teamAvailable={team.isSuccess && Boolean(team.data?.team)}
        onClose={() => setCreatingTag(false)}
      />
    </>
  );
}
