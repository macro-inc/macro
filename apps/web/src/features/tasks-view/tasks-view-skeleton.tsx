import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';

/** Tasks while its code loads: the task lists and the searchable list. */
export function TasksViewSkeleton() {
  return (
    <ViewSkeleton.Root asidePreferenceKey="tasks">
      <ViewSkeleton.Sidebar title="Tasks" createLabel="New task" />
      <ViewSkeleton.Main
        title="My tasks"
        controls={[1, 3, 2, '+ New ⌄', 1]}
        searchPlaceholder="Search tasks"
      />
    </ViewSkeleton.Root>
  );
}
