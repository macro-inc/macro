import { UserIcon } from '@core/component/UserIcon';
import type { PotentialTask } from '@core/util/taskExtraction';
import CircleDashed from '@icon/regular/circle-dashed.svg';
import { For, Show } from 'solid-js';

type TaskPreviewPanelProps = {
  tasks: PotentialTask[];
};

/**
 * Preview panel displaying tasks that will be created when sending a message
 * with Task Mode enabled. Shows task titles with assignee avatars.
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
      <div class="flex flex-col gap-1.5 max-h-32 overflow-y-auto">
        <For each={props.tasks}>
          {(task) => (
            <div class="flex items-center gap-2 text-sm py-0.5">
              <CircleDashed class="size-4 text-ink-placeholder flex-shrink-0" />
              <span class="truncate flex-1 text-ink">
                {task.title || '(empty)'}
              </span>
              <Show when={task.assigneeUserIds.length > 0}>
                <div class="flex items-center -space-x-1.5">
                  <For each={task.assigneeUserIds.slice(0, 3)}>
                    {(userId) => (
                      <div class="bg-surface rounded-full p-[1px]">
                        <UserIcon id={userId} size="xs" suppressClick />
                      </div>
                    )}
                  </For>
                  <Show when={task.assigneeUserIds.length > 3}>
                    <span class="text-xs text-ink-muted pl-1">
                      +{task.assigneeUserIds.length - 3}
                    </span>
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
