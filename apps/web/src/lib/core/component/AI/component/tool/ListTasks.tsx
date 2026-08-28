import { useSplitLayout } from '@components/app/split-layout/layout';
import { EntityIcon } from '@core/component/EntityIcon';
import ListChecks from '@phosphor-icons/core/regular/list-checks.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type { ListTasks as ListTasksCall } from '@service-cognition/generated/tools/types';
import { format } from 'date-fns';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type ListTasksResponse = NamedTool<'ListTasks', 'response'>['data'];
type TaskListItem = ListTasksResponse['tasks'][number];

const STATUS_LABEL: Record<string, string> = {
  not_started: 'not started',
  in_progress: 'in progress',
  in_review: 'in review',
  completed: 'completed',
  canceled: 'canceled',
};

const SORT_LABEL: Record<string, string> = {
  priority: 'priority',
  status: 'status',
  due_date: 'due date',
  recently_updated: 'recently updated',
  recently_viewed: 'recently viewed',
  recently_created: 'recently created',
};

const formatDueDate = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return format(date, 'MMM d');
};

const formatTaskFilters = (data: ListTasksCall) => {
  const parts: string[] = [data.scope === 'all' ? 'all tasks' : 'my tasks'];
  if (data.status?.length) {
    parts.push(
      data.status.map((status) => STATUS_LABEL[status] ?? status).join(', ')
    );
  }
  if (data.priority?.length) {
    parts.push(data.priority.join(', '));
  }
  if (data.assignee) {
    parts.push(`assigned to ${data.assignee}`);
  }
  if (data.search) {
    parts.push(`matching "${data.search}"`);
  }
  if (data.sortBy) {
    parts.push(`by ${SORT_LABEL[data.sortBy] ?? data.sortBy}`);
  }
  return parts.join(' · ');
};

const taskSubtitle = (task: TaskListItem) => {
  const parts: string[] = [];
  if (task.status?.label) parts.push(task.status.label);
  if (task.priority?.label) parts.push(task.priority.label);
  if (task.dueDate) parts.push(`Due ${formatDueDate(task.dueDate)}`);
  return parts.join(' · ');
};

const TaskRow = (props: { task: TaskListItem }) => {
  const { replaceOrInsertSplit } = useSplitLayout();

  return (
    <button
      type="button"
      class="block w-full text-left hover:bg-hover"
      onClick={() => {
        replaceOrInsertSplit({ type: 'task', id: props.task.id });
      }}
    >
      <Tool.ListItem
        icon={<EntityIcon targetType="task" size="xs" theme="monochrome" />}
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-xs text-ink">{props.task.name}</div>
          <Show when={taskSubtitle(props.task)}>
            {(subtitle) => (
              <div class="truncate text-xs text-ink-placeholder">
                {subtitle()}
              </div>
            )}
          </Show>
        </div>
      </Tool.ListItem>
    </button>
  );
};

const ListTasksToolResponse = (props: { tasks: TaskListItem[] }) => (
  <Tool.List>
    <div class="max-h-60 overflow-y-auto overscroll-contain">
      <Show
        when={props.tasks.length > 0}
        fallback={<Tool.ListItem>No matching tasks.</Tool.ListItem>}
      >
        <For each={props.tasks}>{(task) => <TaskRow task={task} />}</For>
      </Show>
    </div>
  </Tool.List>
);

const handler = createToolRenderer({
  name: 'ListTasks',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const tasks = () => ctx.response?.data.tasks ?? [];
    const hasResults = () => tasks().length > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      const count = tasks().length;
      if (count === 0) return 'No Results';
      return `${count} task${count === 1 ? '' : 's'}`;
    };

    return (
      <BaseTool
        icon={ListChecks}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <ListTasksToolResponse tasks={tasks()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">
            List tasks
            <Show when={formatTaskFilters(ctx.tool.data)}>
              {(filters) => (
                <span class="text-ink-placeholder"> · {filters()}</span>
              )}
            </Show>
          </span>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasResults()}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});

export const listTasksHandler = handler;
