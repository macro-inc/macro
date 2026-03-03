import { For, Show, splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { useInput } from './context';

export function TaskPreview(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const input = useInput();
  const [local, rest] = splitProps(props, ['class', 'children']);

  const tasks = () => input().tasks ?? [];
  const shouldRender = () => !!input().taskModeEnabled && tasks().length > 0;

  return (
    <Show when={shouldRender()}>
      <div
        class={cn('w-full border-t border-edge-muted px-3 py-2', local.class)}
        data-input-task-preview
        {...rest}
      >
        <Show
          when={local.children}
          fallback={
            <>
              <div class="flex items-center gap-2 text-xs text-ink-muted mb-2">
                <span>Tasks</span>
                <span class="bg-surface px-1.5 py-0.5 rounded text-xs font-medium">
                  {tasks().length}
                </span>
              </div>
              <div class="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
                <For each={tasks()}>
                  {(task) => <div class="truncate text-sm">{task.title}</div>}
                </For>
              </div>
            </>
          }
        >
          {local.children}
        </Show>
      </div>
    </Show>
  );
}
