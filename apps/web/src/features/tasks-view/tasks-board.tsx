import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useUserId } from '@core/context/user';
import { usePropertyUserDisplay } from '@property/hooks/usePropertyUserDisplay';
import type { Accessor } from 'solid-js';
import { toTaskBoardGrouping } from './core/task-board';
import { createTaskBoardQueries } from './queries/task-board-queries';
import { useTasksView } from './tasks-view-context';
import { TaskBoardView } from './views/task-board-view';

/** Connects the task view to query adapters and app navigation. */
export function TasksBoard(props: { ref?: (element: HTMLDivElement) => void }) {
  const { state, source, openTask, projectsEnabled } = useTasksView();
  const panel = useSplitPanelOrThrow();
  const queries = createTaskBoardQueries({
    rows: source.boardRows ?? source.items,
    grouping: () => toTaskBoardGrouping(state.groupBy),
    searching: source.boardSearching ?? (() => !!state.search.trim()),
    userId: useUserId(),
    projectsEnabled,
    facets: () => state.facets,
    sort: () => state.sort,
  });
  const data = {
    ...queries,
    createAssigneeName: (id: Accessor<string>) =>
      usePropertyUserDisplay(id).name,
  };

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <TaskBoardView
        ref={props.ref}
        data={data}
        onOpen={(task, event) => {
          const opened = openTask(
            { id: task.id, fallbackName: task.name },
            { event }
          );

          if (opened) {
            return;
          }

          const entity = data.entity(task.id);

          if (!entity) {
            return;
          }

          void openEntityInSplitFromUnifiedList(entity, {
            splitHandle: panel.handle,
            referredFrom: 'tasks',
            openInNewSplit:
              event.shiftKey || event.metaKey || event.ctrlKey || event.altKey,
          });
        }}
      />
    </div>
  );
}
