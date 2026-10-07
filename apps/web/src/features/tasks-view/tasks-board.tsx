import { openEntityInSplitFromUnifiedList } from '@app/features/next-soup/utils';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { getTaskReferencedEntityIds } from '@entity/utils/task-properties';
import { usePropertyUserDisplay } from '@property/hooks/usePropertyUserDisplay';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { hasValue } from '@property/utils/typeGuards';
import { type Accessor, For, mapArray, Show, Suspense } from 'solid-js';
import {
  TaskBoardColumnIcon,
  TaskBoardProperty,
} from './components/task-board-property';
import { TASK_SORT_OPTIONS } from './constants';
import type { TaskBoardTask } from './core/task-board';
import { taskBoardFacetId, taskBoardPropertyId } from './queries/task-board';
import { createTaskBoardQueries } from './queries/task-board-queries';
import { useTasksView } from './tasks-view-context';
import { TaskBoardView } from './views/task-board-view';

const CARD_PROPERTY_IDS = [
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
  SYSTEM_PROPERTY_IDS.PROJECT,
];

/** App-facing wiring. No task or app context is required by the shared board. */
export function TasksBoard(props: { ref?: (element: HTMLDivElement) => void }) {
  const { state, source, openTask, projectsEnabled, setFacets } =
    useTasksView();
  const panel = useSplitPanelOrThrow();
  const rows = source.boardRows ?? source.items;

  const assignees = mapArray(
    () => {
      if (state.boardGroupBy !== 'assignee') {
        return [];
      }

      const ids = rows().flatMap((row) => {
        if (row.kind === 'entity') {
          return getTaskReferencedEntityIds(
            row.entity,
            SYSTEM_PROPERTY_IDS.ASSIGNEES
          );
        }

        if (row.kind === 'group-header' && row.groupId) {
          return [row.groupId];
        }

        return [];
      });

      return [...new Set(ids)];
    },
    (id) => ({ id, display: usePropertyUserDisplay(() => id) })
  );

  const data = createTaskBoardQueries({
    rows,
    grouping: () => state.boardGroupBy,
    searching: source.boardSearching ?? (() => !!state.search.trim()),
    userId: useUserId(),
    projectsEnabled,
    facets: () => state.facets,
    sort: () => state.sort,
    assigneeName: (id) => {
      const assignee = assignees().find((entry) => entry.id === id);

      return assignee?.display.name();
    },
  });

  const cardPropertyIds = () => {
    const groupingProperty = taskBoardPropertyId(state.boardGroupBy);

    return CARD_PROPERTY_IDS.filter((id) => {
      if (id === groupingProperty) {
        return false;
      }

      return id !== SYSTEM_PROPERTY_IDS.PROJECT || projectsEnabled();
    });
  };

  const revealHiddenColumns = () => {
    const facets = { ...state.facets };
    delete facets[taskBoardFacetId(state.boardGroupBy)];

    setFacets(facets);
  };

  const loadMore = async (columnId?: string) => {
    if (columnId === undefined) {
      await source.loadMore();

      const error = source.error();

      if (error) {
        throw error;
      }

      return;
    }

    await source.loadMoreGroup(columnId);

    const error = source.groupError?.(columnId);

    if (error) {
      throw error;
    }
  };

  const renderProperty = (
    task: Accessor<TaskBoardTask>,
    readOnly: Accessor<boolean>,
    id: string,
    iconOnly: boolean,
    includeEmpty = true
  ) => (
    <Show when={data.property(task().id, id)}>
      {(property) => (
        <Show when={includeEmpty || hasValue(property())}>
          <Suspense fallback={<span class="size-6" />}>
            <TaskBoardProperty
              property={property()}
              taskId={task().id}
              canEdit={!readOnly() && data.canEditProperty(task().id, id)}
              iconOnly={iconOnly}
              onSave={async (value, apiValues) => {
                try {
                  if (readOnly()) {
                    throw new Error('Task is no longer editable');
                  }

                  await data.saveProperty(task().id, value, apiValues);
                } catch (error) {
                  toast.failure(
                    `Could not update ${value.displayName.toLowerCase()}`
                  );
                  throw error;
                }
              }}
            />
          </Suspense>
        </Show>
      )}
    </Show>
  );

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <TaskBoardView
        ref={props.ref}
        renderColumnIcon={(column) => (
          <Suspense>
            <TaskBoardColumnIcon
              grouping={state.boardGroupBy}
              id={column().id}
            />
          </Suspense>
        )}
        renderLeadingTitleProperty={(task, readOnly) =>
          renderProperty(task, readOnly, SYSTEM_PROPERTY_IDS.STATUS, true)
        }
        renderTitleProperty={(task, readOnly) =>
          renderProperty(task, readOnly, SYSTEM_PROPERTY_IDS.ASSIGNEES, true)
        }
        renderProperties={(task, readOnly) => (
          <For each={cardPropertyIds()}>
            {(id) => {
              const iconOnly = id === SYSTEM_PROPERTY_IDS.PRIORITY;
              const includeEmpty = id === SYSTEM_PROPERTY_IDS.PRIORITY;

              return renderProperty(task, readOnly, id, iconOnly, includeEmpty);
            }}
          </For>
        )}
        data={data}
        sortLabel={() =>
          TASK_SORT_OPTIONS.find(
            (option) => option.id === (state.sort[0]?.id ?? 'updated_at')
          )?.label ?? 'Updated'
        }
        onRevealHiddenColumns={revealHiddenColumns}
        grouping={() => state.boardGroupBy}
        scope={() =>
          JSON.stringify([
            state.tab,
            state.boardGroupBy,
            state.search,
            state.facets,
            state.sort,
          ])
        }
        loading={source.boardLoading ?? source.isLoading}
        error={source.error}
        hasMore={source.hasMore}
        loadingMore={source.isLoadingMore}
        refresh={source.refresh}
        loadMore={loadMore}
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
