import { useCreateContext } from '@app/features/command/context/create-context';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { usePropertyUserDisplay } from '@property/hooks/usePropertyUserDisplay';
import type { Accessor } from 'solid-js';
import { toTaskBoardGrouping } from './core/task-board';
import { createTaskBoardQueries } from './queries/task-board-queries';
import { taskBoardComposerContext } from './task-composer';
import { useTasksView } from './tasks-view-context';
import { TaskBoardView } from './views/task-board-view';

/** Connects the task view to query adapters and app navigation. */
export function TasksBoard(props: { ref?: (element: HTMLDivElement) => void }) {
  const context = useTasksView();
  const { state, source, openTask, projectsEnabled } = context;
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const createContext = useCreateContext();
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

  const canCreate = () => !!context.createTask || !context.scopeKey;
  const createTask = (columnId: string) => {
    if (!canCreate()) return;
    const composerContext = taskBoardComposerContext({
      grouping: toTaskBoardGrouping(state.groupBy),
      columnId,
      scopeKey: context.scopeKey ?? panel.handle.id,
      context: createContext.snapshot('task', panel.handle.id),
    });
    if (context.createTask) {
      context.createTask({ composerContext });
      return;
    }
    layout.popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: { composerContext },
    });
  };

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <TaskBoardView
        ref={props.ref}
        data={data}
        onCreate={canCreate() ? createTask : undefined}
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

          fireAndForget(
            openEntityInSplitFromUnifiedList(entity, {
              splitHandle: panel.handle,
              referredFrom: 'tasks',
              openInNewSplit:
                event.shiftKey ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey,
            }),
            'open-entity-in-split'
          );
        }}
      />
    </div>
  );
}
