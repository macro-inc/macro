import type { PotentialTask } from '@core/util/taskExtraction';
import { For } from 'solid-js';
import { TaskPreviewRow } from './TaskPreviewRow';

type TaskPreviewPanelProps = {
  tasks: PotentialTask[];
  onUpdateTaskProperty: (
    lineIndex: number,
    property: 'statusOptionId' | 'priorityOptionId' | 'dueDate',
    value: string | null
  ) => void;
  onUpdateTaskAssignees: (lineIndex: number, assigneeUserIds: string[]) => void;
};

/**
 * Preview panel displaying tasks that will be created when sending a message
 * with Task Mode enabled. Shows task titles with editable property pills.
 */
export function TaskPreviewPanel(props: TaskPreviewPanelProps) {
  return (
    <div class="w-full border-t border-edge-muted bg-surface-secondary px-3 py-2">
      <div class="flex items-center gap-2 text-xs text-ink-muted mb-2">
        <span>Tasks</span>
        <span class="bg-surface px-1.5 py-0.5 rounded text-xs font-medium">
          {props.tasks.length}
        </span>
      </div>
      <div class="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
        <For each={props.tasks}>
          {(task) => (
            <TaskPreviewRow
              task={task}
              onUpdateProperty={(prop, value) =>
                props.onUpdateTaskProperty(task.lineIndex, prop, value)
              }
              onUpdateAssignees={(assigneeUserIds) =>
                props.onUpdateTaskAssignees(task.lineIndex, assigneeUserIds)
              }
            />
          )}
        </For>
      </div>
    </div>
  );
}
