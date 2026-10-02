import CaretDown from '@phosphor/caret-down.svg';
import FileText from '@phosphor/file-text.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Plus from '@phosphor/plus.svg';
import Table from '@phosphor/table.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { homepagePeople } from '../../core/homepage-demo-people';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewShell } from '../DemoWorkspaceChrome';
import { SearchBar } from '../email/frozen/SearchBar';
import { TaskNotebook } from './frozen/TaskNotebook';
import {
  PersonIcon,
  TaskOwnerMenu,
  TaskPriorityMenu,
  TaskStatusMenu,
} from './frozen/TaskProperties';

export type TaskFilter =
  | 'reviews'
  | 'all'
  | 'mine'
  | 'created'
  | 'Launch'
  | 'Product'
  | 'Customers';

export function WorkspaceTasks(props: {
  workspace: DummyWorkspace;
  filter: TaskFilter;
}) {
  const w = props.workspace;
  const [hideCompleted, setHideCompleted] = createSignal(false);
  const [sort, setSort] = createSignal<'title' | 'status'>('title');
  const selected = () => w.data.tasks.find((task) => task.id === w.selected());
  const tasks = () =>
    w.data.tasks
      .filter(
        (task) =>
          (props.filter === 'all' ||
            (props.filter === 'reviews' && task.status === 'In Review') ||
            (props.filter === 'mine' && task.owner === 'jacob') ||
            (props.filter === 'created' && task.creator === 'jacob') ||
            task.tags.includes(props.filter)) &&
          (!hideCompleted() || task.status !== 'Completed') &&
          `${task.title} ${task.description} ${task.owner}`
            .toLowerCase()
            .includes(w.query().toLowerCase())
      )
      .slice()
      .sort((a, b) => a[sort()].localeCompare(b[sort()]));
  const title = () =>
    props.filter === 'mine'
      ? 'My Tasks'
      : props.filter === 'created'
        ? 'Created by me'
        : props.filter === 'all'
          ? 'All Tasks'
          : props.filter;
  return (
    <Show
      when={selected()}
      fallback={
        <>
          <ViewShell.TopBar>
            <span class="text-sm font-medium">{title()}</span>
            <span class="ml-auto text-xs text-ink-extra-muted">
              {tasks().length} tasks
            </span>
          </ViewShell.TopBar>
          <div class="flex items-center gap-3 px-4 py-4">
            <SearchBar
              label="Search tasks"
              placeholder="Search tasks"
              value={w.query()}
              onValueChange={w.setQuery}
              class="max-w-md flex-1"
              hotkey="cmd+f"
            />
            <Dropdown modal={false}>
              <Dropdown.Trigger aria-label="Task display options" size="sm">
                Display
                <CaretDown />
              </Dropdown.Trigger>
              <Dropdown.Content portalScope="local">
                <Dropdown.Group>
                  <Dropdown.CheckboxItem
                    checked={hideCompleted()}
                    onChange={setHideCompleted}
                  >
                    Hide completed
                  </Dropdown.CheckboxItem>
                  <Dropdown.Item onSelect={() => setSort('title')}>
                    Sort by title
                  </Dropdown.Item>
                  <Dropdown.Item onSelect={() => setSort('status')}>
                    Sort by status
                  </Dropdown.Item>
                </Dropdown.Group>
              </Dropdown.Content>
            </Dropdown>
          </div>
          <div
            class="dummy-scroll dummy-task-list @container/u-list"
            role="table"
            aria-label="Workspace tasks"
          >
            <div class="dummy-task-row text-xs text-ink-extra-muted" role="row">
              <span />
              <span role="columnheader">Task</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Priority</span>
              <span role="columnheader">Assignees</span>
              <span role="columnheader" class="dummy-created">
                Created by
              </span>
              <span class="text-right dummy-updated" role="columnheader">
                Updated
              </span>
            </div>
            <div class="mx-2 px-2 h-8 rounded-lg bg-hover text-xs text-ink-muted flex items-center gap-2">
              <CaretDown class="size-3" />
              {title()}
              <span class="rounded-full px-1.5 bg-active">
                {tasks().length}
              </span>
            </div>
            <For each={tasks()}>
              {(task) => (
                <div
                  class="dummy-task-row group hover:bg-list-hover rounded-xl"
                  role="row"
                >
                  <span class="size-1.5 rounded-full bg-accent opacity-0 group-hover:opacity-100" />
                  <button
                    type="button"
                    class="flex items-center gap-2 min-w-0 text-left font-medium"
                    onClick={() => w.open('tasks', task.id)}
                    aria-label={`Open task ${task.title}`}
                  >
                    <ListChecks class="size-4 shrink-0 text-task" />
                    <span class="truncate">{task.title}</span>
                  </button>
                  <div role="cell">
                    <TaskStatusMenu
                      inline
                      task={task}
                      onSave={(status) => w.updateTask(task.id, { status })}
                    />
                  </div>
                  <div role="cell">
                    <TaskPriorityMenu
                      inline
                      task={task}
                      onSave={(priority) => w.updateTask(task.id, { priority })}
                    />
                  </div>
                  <div role="cell">
                    <TaskOwnerMenu
                      inline
                      task={task}
                      onSave={(owner) => w.updateTask(task.id, { owner })}
                    />
                  </div>
                  <span class="dummy-created flex items-center gap-1.5 text-ink-muted text-xs">
                    <PersonIcon person={task.creator} />
                    {homepagePeople[task.creator].shortName}
                  </span>
                  <span class="dummy-updated text-right text-xs text-ink-extra-muted">
                    Today
                  </span>
                </div>
              )}
            </For>
            <Show when={!tasks().length}>
              <p class="p-8 text-ink-muted text-sm">No matching tasks.</p>
            </Show>
            <Button
              variant="plain"
              size="sm"
              class="m-4"
              onClick={() => w.createTask()}
            >
              <Plus />
              New task
            </Button>
          </div>
        </>
      }
    >
      {(task) => (
        <TaskNotebook
          workspace={w}
          task={task()}
          relatedContent={
            <div class="mt-8 mb-6">
              <h2 class="text-sm font-medium text-ink-muted mb-3">
                Related files
              </h2>
              <div class="flex flex-wrap gap-2">
                <For
                  each={w.data.documents.filter(
                    (doc) =>
                      doc.id === 'plan' ||
                      doc.id === 'launch-metrics' ||
                      (task().id === 'deploy'
                        ? doc.id === 'release-checks'
                        : doc.id === 'rollout')
                  )}
                >
                  {(doc) => (
                    <button
                      type="button"
                      class="flex items-center gap-2 rounded-lg bg-surface-2 hover:bg-hover px-3 py-2 text-sm text-ink-muted"
                      onClick={() =>
                        w.openItem(
                          doc.kind === 'spreadsheet'
                            ? 'spreadsheet'
                            : 'documents',
                          doc.id
                        )
                      }
                    >
                      <Show
                        when={doc.kind === 'spreadsheet'}
                        fallback={<FileText class="size-4 text-document" />}
                      >
                        <Table class="size-4 text-success" />
                      </Show>
                      {doc.title}
                    </button>
                  )}
                </For>
              </div>
            </div>
          }
        />
      )}
    </Show>
  );
}
