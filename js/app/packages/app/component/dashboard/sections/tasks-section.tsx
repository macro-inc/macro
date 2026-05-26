import { useSplitLayout } from '@app/component/split-layout/layout';
import { useUserContext } from '@core/context/user';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { UserIcon } from '@core/component/UserIcon';
import {
  getTaskAssigneeIds,
  getTaskStatusOptionId,
  isCurrentUserAssigned,
  isTaskClosed,
} from '@entity';
import { getTaskPriorityOptionId } from '@entity/utils/task-properties';
import { Entity, isTaskEntity, type TaskEntity } from '@entity';
import CheckCircleIcon from '@phosphor/check-circle.svg';
import PlusIcon from '@phosphor/plus.svg';
import TaskIcon from '@icon/wide-task.svg';
import { Button } from '@ui';
import {
  type SoupItemsQueryArgs,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import {
  DashboardEmptyState,
  DashboardSection,
} from '../dashboard-section';
import { DashboardSectionLoading } from '../dashboard-section-loading';

const TASKS_INITIAL = 8;
const TASKS_INCREMENT = 10;

interface TasksSectionProps {
  class?: string;
}

export function TasksSection(props: TasksSectionProps) {
  const { openWithSplit } = useSplitLayout();
  const [limit, setLimit] = createSignal(TASKS_INITIAL);

  const handleSeeAll = () => {
    openWithSplit({ type: 'component', id: 'tasks' });
  };

  return (
    <DashboardSection
      title="My Tasks"
      icon={<TaskIcon />}
      accent="task"
      class={props.class}
      onSeeAll={handleSeeAll}
      fallback={<DashboardSectionLoading rows={TASKS_INITIAL} />}
    >
      <TasksContent
        limit={limit()}
        onLoadMore={() => setLimit((l) => l + TASKS_INCREMENT)}
      />
    </DashboardSection>
  );
}

const PRIORITY_LABELS: Record<string, string> = {
  [PROPERTY_OPTION_IDS.PRIORITY.LOW]: 'Low',
  [PROPERTY_OPTION_IDS.PRIORITY.MEDIUM]: 'Medium',
  [PROPERTY_OPTION_IDS.PRIORITY.HIGH]: 'High',
  [PROPERTY_OPTION_IDS.PRIORITY.URGENT]: 'Urgent',
};

function TaskRow(props: { task: TaskEntity; onClick: () => void }) {
  const statusOptionId = () =>
    getTaskStatusOptionId(props.task) ?? PROPERTY_OPTION_IDS.STATUS.NOT_STARTED;
  const priorityOptionId = () => getTaskPriorityOptionId(props.task);
  const priorityLabel = () => {
    const id = priorityOptionId();
    return id ? PRIORITY_LABELS[id] : null;
  };
  const assigneeIds = () => getTaskAssigneeIds(props.task).slice(0, 3);
  const extraAssignees = () => Math.max(0, getTaskAssigneeIds(props.task).length - 3);

  return (
    <button
      type="button"
      onClick={props.onClick}
      class="flex items-center gap-3 py-2.5 px-3 w-full text-left hover:bg-ink/5 rounded-lg transition-colors"
    >
      <div class="size-5 flex items-center justify-center shrink-0">
        <PropertyValueIcon optionId={statusOptionId()} class="size-4" />
      </div>
      <div class="flex-1 min-w-0 text-sm text-ink truncate">
        <Entity.Title entity={props.task} />
      </div>
      <div class="flex items-center gap-3 shrink-0">
        <Show when={priorityLabel()}>
          <span class="flex items-center gap-1 text-xs text-ink-muted">
            <PropertyValueIcon optionId={priorityOptionId()!} class="size-3.5" />
            {priorityLabel()}
          </span>
        </Show>
        <Show when={assigneeIds().length > 0}>
          <div class="flex items-center gap-1">
            <div class="flex -space-x-1.5">
              <For each={assigneeIds()}>
                {(id) => <UserIcon id={id} size="sm" suppressClick />}
              </For>
            </div>
            <Show when={extraAssignees() > 0}>
              <span class="text-xs text-ink-muted">+{extraAssignees()}</span>
            </Show>
          </div>
        </Show>
      </div>
    </button>
  );
}

function InfiniteScrollTrigger(props: { onIntersect: () => void }) {
  let ref: HTMLDivElement | undefined;

  createEffect(() => {
    if (!ref) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          props.onIntersect();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(ref);
    onCleanup(() => observer.disconnect());
  });

  return <div ref={ref} class="h-4 shrink-0" />;
}

function TasksContent(props: { limit: number; onLoadMore: () => void }) {
  const user = useUserContext();
  const { openWithSplit } = useSplitLayout();

  const tasksArgs = createMemo(
    (): SoupItemsQueryArgs => ({
      params: {
        sort_method: 'updated_at',
        limit: 100,
      },
      body: {
        document_filters: {
          sub_types: ['task'],
        },
      },
    })
  );

  const tasksQuery = useSoupItemsQuery(tasksArgs, () => ({
    enabled: !!user.userId(),
  }));

  const allTasks = createMemo(() => {
    const data = tasksQuery.data ?? [];
    const userId = user.userId();
    return data
      .filter(isTaskEntity)
      .filter((task) => !isTaskClosed(task))
      .filter((task) => (userId ? isCurrentUserAssigned(task, userId) : true));
  });

  const displayedTasks = createMemo(() => allTasks().slice(0, props.limit));
  const hasMore = createMemo(() => allTasks().length > props.limit);

  const handleTaskClick = (task: TaskEntity) => {
    openWithSplit({
      type: 'md',
      id: task.id,
    });
  };

  const handleCreateTask = () => {
    openWithSplit({ type: 'md', id: 'new', params: { subType: 'task' } });
  };

  return (
    <Show
      when={displayedTasks().length > 0}
      fallback={
        <DashboardEmptyState
          icon={<CheckCircleIcon />}
          title="All caught up"
          description="No active tasks assigned to you"
          action={
            <Button variant="ghost" size="sm" onClick={handleCreateTask} class="mt-2 gap-1">
              <PlusIcon class="size-3.5" />
              <span>Create task</span>
            </Button>
          }
        />
      }
    >
      <div class="flex flex-col max-h-[400px] overflow-y-auto -m-3">
        <For each={displayedTasks()}>
          {(task) => (
            <TaskRow task={task} onClick={() => handleTaskClick(task)} />
          )}
        </For>
        <Show when={hasMore()}>
          <InfiniteScrollTrigger onIntersect={props.onLoadMore} />
        </Show>
      </div>
    </Show>
  );
}
