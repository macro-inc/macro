import { Gantt } from '@app/components/gantt/gantt';
import {
  resolveEntityActionViewContext,
  toSingleEntityActionListState,
} from '@app/features/next-soup/actions';
import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { SoupEntityContextMenu } from '@app/features/soup';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { TaskEntityWithProperties } from '@entity';
import { usePropertyUserDisplay } from '@property/hooks/usePropertyUserDisplay';
import type { Accessor, JSX } from 'solid-js';
import { taskGanttDates } from './queries/task-gantt';
import { createTaskGanttQueries } from './queries/task-gantt-queries';
import { useTasksView } from './tasks-view-context';
import { TaskGanttView } from './views/task-gantt-view';

/** Reuses the host's filtered task source and task-opening capability. */
export function TasksGantt(props: { ref?: (element: HTMLDivElement) => void }) {
  const context = useTasksView();
  const { source, state, setState, openTask } = context;
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const createTask = (dueDate?: Date) =>
    layout.popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: { initialDueDate: dueDate },
    });
  const onCreate = () =>
    context.createTask ?? (!context.scopeKey ? createTask : undefined);
  const queries = createTaskGanttQueries(source.items);
  const viewContext = () =>
    resolveEntityActionViewContext({
      activeListView: panel.handle.content().id,
      activeTab: state.tab,
    });
  const onOpen = (task: TaskEntityWithProperties, event: MouseEvent) => {
    const opened = openTask(
      { id: task.id, fallbackName: task.name },
      { event }
    );

    if (opened) return;

    void openEntityInSplitFromUnifiedList(task, {
      splitHandle: panel.handle,
      referredFrom: 'tasks',
      openInNewSplit:
        event.shiftKey || event.metaKey || event.ctrlKey || event.altKey,
    });
  };
  const renderEntity = (
    task: Accessor<TaskEntityWithProperties>,
    label: JSX.Element
  ) => {
    const list = toSingleEntityActionListState(task);
    return (
      <SoupEntityContextMenu
        as="div"
        entity={task()}
        list={list}
        selectedEntities={() => []}
        viewContext={viewContext()}
      >
        {label}
        <Gantt.Bar
          {...taskGanttDates(task())}
          title={task().name}
          onClick={(event) => onOpen(task(), event)}
          onEndChange={
            queries.canEdit(task().id)
              ? (date: Date) => queries.saveEnd(task().id, date)
              : undefined
          }
        >
          {task().name}
        </Gantt.Bar>
      </SoupEntityContextMenu>
    );
  };

  return (
    <TaskGanttView
      ref={props.ref}
      source={source}
      groupBy={state.groupBy}
      createAssigneeName={(id) => usePropertyUserDisplay(id).name}
      isGroupExpanded={(id) => !state.collapsedGroupIds.includes(id)}
      onToggleGroup={(id) =>
        setState('collapsedGroupIds', (ids) =>
          ids.includes(id)
            ? ids.filter((current) => current !== id)
            : [...ids, id]
        )
      }
      onCreate={onCreate() && ((dates) => onCreate()?.(dates.end))}
      onOpen={onOpen}
      renderEntity={renderEntity}
    />
  );
}
