import { SearchBar } from '@app/components/view-shell/SearchBar';
import { TaskListHeaderSurface } from '@app/features/tasks-view/components/task-list/TaskListHeader';
import {
  TASK_GRID_TEMPLATE_AREAS_WIDE,
  TASK_GRID_TEMPLATE_COLUMNS_WIDE,
} from '@app/features/tasks-view/components/task-list/task-grid-template';
import { Entity } from '@entity';
import CaretDown from '@phosphor/caret-down.svg';
import ListChecks from '@phosphor/list-checks.svg';
import { PropertyValueIcon } from '@property/component/propertyValue/PropertyValueIcon';
import { PROPERTY_OPTION_IDS } from '@property/constants';
import { createSignal, For } from 'solid-js';
import type { WorkspaceDemo } from '../primitives/createWorkspaceDemo';
import { HomepagePersonAvatar } from './HomepageConversation';
import '@app/features/tasks-view/components/task-list/task-list.css';

export default function HomepageWorkspaceTasks(props: { demo: WorkspaceDemo }) {
  const [query, setQuery] = createSignal('');
  return (
    <div class="workspace-demo-scroll @container/u-list">
      <div class="p-4">
        <SearchBar
          label="Search demo tasks"
          placeholder="Search tasks"
          value={query()}
          onValueChange={setQuery}
          class="max-w-md"
        />
      </div>
      <div role="table" aria-label="Launch tasks" class="px-1">
        <TaskListHeaderSurface
          activeSort={{ id: 'updated_at', reversed: false }}
        />
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
            <div role="row" class="rounded-lg hover:bg-hover">
              <Entity.Layout
                class="task-grid-row grid h-11 w-full items-center gap-2 px-3 text-sm"
                style={{
                  'grid-template-columns': TASK_GRID_TEMPLATE_COLUMNS_WIDE,
                  'grid-template-areas': TASK_GRID_TEMPLATE_AREAS_WIDE,
                }}
              >
                <Entity.Slot
                  placement="content"
                  class="flex min-w-0 items-center gap-2"
                >
                  <ListChecks class="size-4 shrink-0 text-task" />
                  <span class="truncate font-medium">{task.label}</span>
                </Entity.Slot>
                <Entity.Slot placement="status" class="flex justify-center">
                  <button
                    type="button"
                    aria-label={`${task.done ? 'Reopen' : 'Complete'} ${task.label}`}
                    onClick={() => props.demo.toggleTask(task.id)}
                    class="rounded p-1 hover:bg-active"
                  >
                    <PropertyValueIcon
                      optionId={
                        task.done
                          ? PROPERTY_OPTION_IDS.STATUS.COMPLETED
                          : PROPERTY_OPTION_IDS.STATUS.NOT_STARTED
                      }
                      class="size-4"
                    />
                  </button>
                </Entity.Slot>
                <Entity.Slot placement="priority" class="flex justify-center">
                  <PropertyValueIcon
                    optionId={PROPERTY_OPTION_IDS.PRIORITY.HIGH}
                    class="size-4"
                  />
                </Entity.Slot>
                <Entity.Slot
                  placement="assignees"
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
                </Entity.Slot>
                <Entity.Slot
                  placement="timestamp"
                  class="text-right text-xs font-light text-ink-extra-muted"
                >
                  Sep 24
                </Entity.Slot>
              </Entity.Layout>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
