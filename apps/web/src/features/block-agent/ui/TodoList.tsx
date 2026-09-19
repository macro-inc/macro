/**
 * The agent's plan as a checklist: a read-only checkbox visual per item, a
 * pulsing dot while an item is in progress, and content that strikes through
 * and mutes once an item is completed or cancelled.
 *
 * Ported from opencode's inner `TodoList` (`session-todo-dock.tsx`) and its
 * historical `todowrite` card body (`message-part.tsx`)
 * (github.com/sst/opencode, MIT © 2025 opencode). Their kobalte Checkbox is
 * replaced with an inline visual, and their motion-based `TextStrikethrough`
 * with a `text-decoration-color` transition.
 */
import { For } from 'solid-js';
import { match } from 'ts-pattern';
import type { TodoItem } from './types';

function CheckMark() {
  return (
    <svg
      viewBox="0 0 12 12"
      width="10"
      height="10"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="block"
      aria-hidden="true"
    >
      <path d="M2.5 6.5 5 9l4.5-5.5" />
    </svg>
  );
}

function PulsingDot() {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="currentColor"
      class="block"
      aria-hidden="true"
    >
      <circle
        cx="6"
        cy="6"
        r="3"
        class="animate-todo-pulse origin-center [transform-box:fill-box] motion-reduce:animate-none"
      />
    </svg>
  );
}

/** The read-only checkbox stand-in: checked, pulsing, or empty. */
function TodoBox(props: { status: TodoItem['status'] }) {
  return (
    <span
      class="mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded border border-edge-muted transition-colors duration-200"
      classList={{ 'text-ink-muted': props.status === 'completed' }}
    >
      {match(props.status)
        .with('completed', () => <CheckMark />)
        .with('in_progress', () => <PulsingDot />)
        .otherwise(() => undefined)}
    </span>
  );
}

/** A read-only rendering of the agent's todo list. */
export function TodoList(props: { todos: TodoItem[] }) {
  return (
    <div class="flex flex-col gap-1.5">
      <For each={props.todos}>
        {(todo) => {
          const struck = () =>
            todo.status === 'completed' || todo.status === 'cancelled';
          return (
            <div class="flex items-start gap-2 text-xs leading-5">
              <TodoBox status={todo.status} />
              <span
                class="min-w-0 wrap-break-word line-through transition-[color,text-decoration-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                classList={{
                  'text-ink decoration-transparent': !struck(),
                  'text-ink-extra-muted decoration-ink-extra-muted': struck(),
                }}
              >
                {todo.content}
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}
