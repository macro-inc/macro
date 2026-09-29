import ArrowDown from '@phosphor/arrow-down.svg';
import CaretDown from '@phosphor/caret-down.svg';
import CheckCircle from '@phosphor/check-circle.svg';
import Circle from '@phosphor/circle.svg';
import ListChecks from '@phosphor/list-checks.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { createSignal, For } from 'solid-js';
import type { WorkspaceDemo } from '../primitives/createWorkspaceDemo';
import { HomepagePersonAvatar } from './HomepageConversation';

/** Frozen task-list layout; toggles only modify this sample's local state. */
export default function HomepageWorkspaceTasks(props: { demo: WorkspaceDemo }) {
  const [query, setQuery] = createSignal('');
  return (
    <div class="workspace-demo-scroll @container/u-list">
      <div class="p-4">
        <label class="flex h-10 max-w-md items-center gap-2 rounded-full border border-edge-button bg-control px-3">
          <SearchIcon class="size-4 text-ink-extra-muted" />
          <input
            type="search"
            aria-label="Search demo tasks"
            placeholder="Search tasks"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            class="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      </div>
      <div role="table" aria-label="Launch tasks" class="px-1">
        <div
          role="row"
          class="grid h-10 grid-cols-[minmax(0,1fr)_54px_54px_54px_60px] items-center gap-2 px-3 text-xs font-medium text-ink-extra-muted"
        >
          <span role="columnheader">Task</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Priority</span>
          <span role="columnheader">Assignees</span>
          <span role="columnheader" class="flex items-center justify-end">
            Updated
            <ArrowDown class="size-3" />
          </span>
        </div>
        <div
          role="row"
          class="flex h-8 items-center gap-2 rounded-lg bg-hover px-3 text-xs text-ink-muted"
        >
          <CaretDown class="size-3" />
          <span>Launch</span>
          <span class="rounded-full bg-active px-1.5">
            {props.demo.tasks().length}
          </span>
        </div>
        <For
          each={props.demo
            .tasks()
            .filter((task) =>
              task.label.toLowerCase().includes(query().toLowerCase())
            )}
        >
          {(task) => (
            <div
              role="row"
              class="grid h-11 grid-cols-[minmax(0,1fr)_54px_54px_54px_60px] items-center gap-2 rounded-lg px-3 text-sm hover:bg-hover"
            >
              <div role="cell" class="flex min-w-0 items-center gap-2">
                <ListChecks class="size-4 shrink-0 text-task" />
                <span class="truncate font-medium">{task.label}</span>
              </div>
              <div role="cell" class="flex justify-center">
                <button
                  type="button"
                  aria-label={`${task.done ? 'Reopen' : 'Complete'} ${task.label}`}
                  onClick={() => props.demo.toggleTask(task.id)}
                  class="rounded p-1 hover:bg-active"
                >
                  {task.done ? (
                    <CheckCircle class="size-4 text-success" />
                  ) : (
                    <Circle class="size-4 text-ink-muted" />
                  )}
                </button>
              </div>
              <div
                role="cell"
                class="flex justify-center text-ink-muted"
                title="High priority"
              >
                <svg class="size-4" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M2 13V9M6 13V6M10 13V3"
                    stroke="currentColor"
                    stroke-width="2"
                  />
                </svg>
              </div>
              <div
                role="cell"
                class="workspace-demo-task-owner flex justify-center"
              >
                <HomepagePersonAvatar
                  person={
                    task.owner === 'Julia'
                      ? 'julia'
                      : task.owner === 'Teo'
                        ? 'teo'
                        : 'jacob'
                  }
                />
              </div>
              <div
                role="cell"
                class="text-right text-xs font-light text-ink-extra-muted"
              >
                Sep 24
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
