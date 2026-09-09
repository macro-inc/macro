/** A read-only plan: compact task rows with explicit state and overall progress. */
import Check from '@phosphor/check.svg';
import { For } from 'solid-js';
import { match } from 'ts-pattern';
import type { TodoItem } from './types';

export function TodoList(props: { todos: TodoItem[] }) {
  const done = () =>
    props.todos.filter((todo) => todo.status === 'completed').length;
  return (
    <section
      aria-label="Plan"
      class="overflow-hidden rounded-xl border border-edge-muted bg-ink/2"
    >
      <header class="flex h-11 items-center justify-between border-b border-edge-muted px-4 text-xs">
        <span class="font-medium text-ink">Plan</span>
        <span class="text-ink-extra-muted">
          {done()} of {props.todos.length} completed
        </span>
      </header>
      <div class="space-y-2 p-3">
        <For each={props.todos}>
          {(todo, index) => (
            <div class="flex min-h-11 items-center gap-3 rounded-xl border border-edge-muted bg-ink/2 px-3 py-2 text-[13px]">
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-full border border-edge-muted text-[11px] text-ink-muted"
                classList={{
                  'text-success bg-success/10 border-success/20':
                    todo.status === 'completed',
                  'text-accent bg-accent/10 border-accent/20':
                    todo.status === 'in_progress',
                }}
              >
                {todo.status === 'completed' ? (
                  <Check class="size-3.5" />
                ) : (
                  index() + 1
                )}
              </span>
              <span
                class="min-w-0 flex-1 text-ink wrap-break-word"
                classList={{
                  'text-ink-extra-muted line-through':
                    todo.status === 'cancelled',
                }}
              >
                {todo.content}
              </span>
              <span
                class="shrink-0 rounded-full bg-ink/5 px-2 py-0.5 text-[11px] text-ink-extra-muted"
                classList={{
                  'text-success bg-success/10': todo.status === 'completed',
                  'text-accent bg-accent/10': todo.status === 'in_progress',
                }}
              >
                {match(todo.status)
                  .with('completed', () => 'Completed')
                  .with('in_progress', () => 'In progress')
                  .with('pending', () => 'Pending')
                  .with('cancelled', () => 'Cancelled')
                  .exhaustive()}
              </span>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
