import Calendar from '@phosphor/calendar-blank.svg';
import Caret from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import ListChecks from '@phosphor/list-checks.svg';
import Stack from '@phosphor/stack.svg';
import X from '@phosphor/x.svg';
import { Button, Dialog, Dropdown } from '@ui';
import { TabsInset } from '@ui/components/TabsInset';
import { createEffect, createSignal, For, Show } from 'solid-js';
import type { WorkspaceTask } from '../../core/dummy-workspace';
import { homepagePeople } from '../../core/homepage-demo-people';
import { ViewShell } from '../DemoWorkspaceChrome';
import { DocumentShareSheet } from '../documents/DocumentShareSheet';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { PanelToggle } from '../workspace/frozen/DetailPanel';
import { MessageRow } from '../workspace/frozen/MessageRow';
import { PropertyValueIcon } from '../workspace/frozen/PropertyValueIcon';
import { TaskNotebook } from '../workspace/frozen/TaskNotebook';
import {
  PRIORITY_IDS,
  STATUS_IDS,
  TaskOwnerMenu,
  TaskPriorityMenu,
  TaskStatusMenu,
} from '../workspace/frozen/TaskProperties';
import { projectStatuses, type TasksWorkspace } from './createTasksWorkspace';
import { TasksWorkspaceControls } from './TasksWorkspaceControls';
import type { DemoProject } from './tasksWorkspaceData';
import './tasks-workspace.css';

function ProjectStatus(props: {
  project: DemoProject;
  save: (status: DemoProject['status']) => void;
  inline?: boolean;
}) {
  return (
    <Dropdown modal={false}>
      <Dropdown.Trigger
        aria-label="Change project status"
        class={props.inline ? 'sample-list-property' : 'tasks-native-pill'}
      >
        <PropertyValueIcon
          optionId={STATUS_IDS[props.project.status]}
          class="size-3"
        />
        <span>{props.project.status}</span>
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local">
        <Dropdown.Group>
          <For each={projectStatuses}>
            {(status) => (
              <Dropdown.Item onSelect={() => props.save(status)}>
                <PropertyValueIcon
                  optionId={STATUS_IDS[status]}
                  class="size-3"
                />
                {status}
                <Show when={status === props.project.status}>
                  <Check class="size-3 ml-auto" />
                </Show>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

export function TaskProjectPicker(props: {
  state: TasksWorkspace;
  taskId: string;
}) {
  const c = props.state;
  return (
    <Dropdown modal={false}>
      <Dropdown.Trigger
        class="tasks-native-project-cell"
        aria-label="Change project"
        title={c.projectName(props.taskId)}
      >
        <Stack class="size-3 shrink-0" />
        <span class="truncate">{c.projectName(props.taskId)}</span>
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local">
        <Dropdown.Group>
          <Dropdown.Item onSelect={() => c.assignProject(props.taskId, '')}>
            No project
          </Dropdown.Item>
          <For each={c.projects}>
            {(project) => (
              <Dropdown.Item
                onSelect={() => c.assignProject(props.taskId, project.id)}
              >
                <Stack class="size-3" />
                {project.title}
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function DateValue(props: { value?: string }) {
  return (
    <Show when={props.value}>
      {(value) => (
        <span class="tasks-native-date">
          <Calendar class="size-3" />
          {new Date(`${value()}T12:00:00`).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      )}
    </Show>
  );
}

function TasksGrid(props: { state: TasksWorkspace }) {
  const c = props.state;
  const [collapsed, setCollapsed] = createSignal<string[]>([]);
  const [selected, setSelected] = createSignal<string[]>([]);
  createEffect(() => {
    c.tab();
    c.projectId();
    setSelected([]);
    setCollapsed([]);
  });
  const toggle = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    );
  const save = (item: WorkspaceTask, patch: Partial<WorkspaceTask>) =>
    c.projectList()
      ? c.saveProject(item.id, patch)
      : c.saveTask(item.id, patch);
  const title = (item: WorkspaceTask) =>
    c.projectList() ? `Open project ${item.title}` : `Open task ${item.title}`;
  const open = (item: WorkspaceTask) =>
    c.projectList() ? c.openProject(item.id) : c.openTask(item.id);
  const board = () => c.layout() === 'Board' && !c.projectList();
  const drop = (event: DragEvent, key: string) => {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain');
    if (!id) return;
    const task = c.w.data.tasks.find((item) => item.id === id);
    if (!task) return;
    if (c.group() === 'Status') {
      const status = Object.keys(STATUS_IDS).find((value) => value === key) as
        | WorkspaceTask['status']
        | undefined;
      if (status) c.saveTask(id, { status });
    }
    if (c.group() === 'Priority') {
      const priority = Object.keys(PRIORITY_IDS).find(
        (value) => value === key
      ) as WorkspaceTask['priority'] | undefined;
      if (priority) c.saveTask(id, { priority });
    }
    if (c.group() === 'Project')
      c.assignProject(
        id,
        c.projects.find((item) => item.title === key)?.id ?? ''
      );
    if (c.group() === 'Assignee') {
      const owner = Object.keys(homepagePeople).find(
        (value) => value === key
      ) as WorkspaceTask['owner'] | undefined;
      if (owner) c.saveTask(id, { owner });
    }
  };
  return (
    <>
      <Show when={selected().length}>
        <div class="tasks-native-selection">
          <span>{selected().length} selected</span>
          <Dropdown modal={false}>
            <Dropdown.Trigger size="sm">Set status</Dropdown.Trigger>
            <Dropdown.Content portalScope="local">
              <For
                each={
                  c.projectList()
                    ? projectStatuses
                    : (Object.keys(STATUS_IDS) as WorkspaceTask['status'][])
                }
              >
                {(status) => (
                  <Dropdown.Item
                    onSelect={() => {
                      for (const id of selected()) {
                        if (c.projectList()) c.saveProject(id, { status });
                        else c.saveTask(id, { status });
                      }
                      setSelected([]);
                    }}
                  >
                    {status}
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Content>
          </Dropdown>
          <Button size="sm" variant="plain" onClick={() => setSelected([])}>
            Clear selection
          </Button>
        </div>
      </Show>
      <div
        class="tasks-native-list"
        data-board={board()}
        role={board() ? 'group' : 'table'}
        aria-label={
          c.projectList() ? 'Projects' : board() ? 'Task board' : 'Tasks list'
        }
      >
        <Show when={!board()}>
          <div role="row" class="tasks-native-grid tasks-native-grid-header">
            <span role="columnheader" />
            <span role="columnheader">
              {c.projectList() ? 'Project' : 'Task'}
            </span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Priority</span>
            <span role="columnheader">Assignees</span>
            <span role="columnheader">
              {c.projectList() ? 'Due date' : 'Project'}
            </span>
            <span role="columnheader" class="tasks-native-updated">
              Updated
            </span>
          </div>
        </Show>
        <div class={board() ? 'tasks-native-board' : ''} data-group={c.group()}>
          <For each={c.groups()}>
            {(group) => (
              <section
                class="tasks-native-task-group"
                onDragOver={(event) => {
                  if (board()) event.preventDefault();
                }}
                onDrop={(event) => drop(event, group.key)}
              >
                <Show when={c.group() !== 'None'}>
                  <button
                    type="button"
                    class="tasks-native-group-heading"
                    aria-expanded={!collapsed().includes(group.key)}
                    onClick={() =>
                      setCollapsed((values) =>
                        values.includes(group.key)
                          ? values.filter((value) => value !== group.key)
                          : [...values, group.key]
                      )
                    }
                  >
                    <Caret
                      class="size-3"
                      style={{
                        transform: collapsed().includes(group.key)
                          ? ''
                          : 'rotate(90deg)',
                      }}
                    />
                    <Show when={c.group() === 'Priority'}>
                      <PropertyValueIcon
                        optionId={
                          PRIORITY_IDS[group.key as WorkspaceTask['priority']]
                        }
                        class="size-3.5"
                      />
                    </Show>
                    <Show when={c.group() === 'Status'}>
                      <PropertyValueIcon
                        optionId={
                          STATUS_IDS[group.key as WorkspaceTask['status']]
                        }
                        class="size-3.5"
                      />
                    </Show>
                    <span>
                      {c.group() === 'Assignee'
                        ? homepagePeople[group.key as WorkspaceTask['owner']]
                            ?.shortName
                        : group.key}
                    </span>
                    <span class="tasks-native-count">{group.items.length}</span>
                  </button>
                </Show>
                <Show when={!collapsed().includes(group.key)}>
                  <For each={group.items}>
                    {(item) => (
                      <div
                        role={board() ? 'article' : 'row'}
                        class={
                          board()
                            ? 'tasks-native-card'
                            : 'tasks-native-grid tasks-native-row'
                        }
                        draggable={board()}
                        onDragStart={(event) =>
                          event.dataTransfer?.setData('text/plain', item.id)
                        }
                      >
                        <Show when={!board()}>
                          <input
                            type="checkbox"
                            aria-label={`Select ${item.title}`}
                            checked={selected().includes(item.id)}
                            onChange={() => toggle(item.id)}
                          />
                        </Show>
                        <button
                          type="button"
                          class="tasks-native-name"
                          data-open-task={item.id}
                          title={item.title}
                          aria-label={title(item)}
                          onClick={() => open(item)}
                        >
                          <Show
                            when={c.projectList()}
                            fallback={<ListChecks class="size-4 text-task" />}
                          >
                            <Stack class="size-4 text-ink-muted" />
                          </Show>
                          <span>{item.title}</span>
                        </button>
                        <div class="tasks-native-status">
                          <Show
                            when={c.projectList()}
                            fallback={
                              <TaskStatusMenu
                                inline
                                task={item}
                                onSave={(status) => save(item, { status })}
                              />
                            }
                          >
                            <ProjectStatus
                              inline
                              project={item as DemoProject}
                              save={(status) => save(item, { status })}
                            />
                          </Show>
                        </div>
                        <div class="tasks-native-priority">
                          <TaskPriorityMenu
                            inline
                            task={item}
                            onSave={(priority) => save(item, { priority })}
                          />
                        </div>
                        <div class="tasks-native-assignee">
                          <TaskOwnerMenu
                            inline
                            task={item}
                            onSave={(owner) => save(item, { owner })}
                          />
                        </div>
                        <div class="tasks-native-project">
                          <Show
                            when={c.projectList()}
                            fallback={
                              <TaskProjectPicker state={c} taskId={item.id} />
                            }
                          >
                            <DateValue value={(item as DemoProject).dueDate} />
                          </Show>
                        </div>
                        <time class="tasks-native-updated">
                          {c.projectList()
                            ? 'Today'
                            : (c.metadata[item.id]?.updated ?? 0) > 96
                              ? 'Today'
                              : (c.metadata[item.id]?.updated ?? 0) > 92
                                ? 'Yesterday'
                                : 'Oct 6'}
                        </time>
                      </div>
                    )}
                  </For>
                </Show>
              </section>
            )}
          </For>
        </div>
        <Show when={!c.groups().some((group) => group.items.length)}>
          <p class="tasks-native-empty">
            {c.search() ||
            c.filters.status.length ||
            c.filters.owner.length ||
            c.filters.priority.length
              ? 'No matching items.'
              : c.projectList()
                ? 'No projects yet.'
                : 'No tasks yet.'}
          </p>
        </Show>
      </div>
    </>
  );
}

function ProjectOverview(props: {
  state: TasksWorkspace;
  project: DemoProject;
}) {
  const c = props.state;
  return (
    <div class="tasks-native-overview dummy-scroll">
      <div>
        <h1
          contentEditable
          role="textbox"
          aria-label="Project name"
          onBlur={(event) =>
            c.saveProject(props.project.id, {
              title:
                event.currentTarget.innerText.trim() || props.project.title,
            })
          }
        >
          {props.project.title}
        </h1>
        <div class="tasks-native-properties">
          <ProjectStatus
            project={props.project}
            save={(status) => c.saveProject(props.project.id, { status })}
          />
          <TaskPriorityMenu
            task={props.project}
            onSave={(priority) => c.saveProject(props.project.id, { priority })}
          />
          <TaskOwnerMenu
            task={props.project}
            onSave={(owner) => c.saveProject(props.project.id, { owner })}
          />
          <DateValue value={props.project.dueDate} />
        </div>
        <div
          contentEditable
          role="textbox"
          aria-label="Project description"
          class="tasks-native-description"
          onBlur={(event) =>
            c.saveProject(props.project.id, {
              description: event.currentTarget.innerText,
            })
          }
        >
          {props.project.description}
        </div>
        <h2 class="tasks-native-discussion-title">Discussion</h2>
        <For each={props.project.comments}>
          {(message) => <MessageRow message={message} />}
        </For>
        <ChannelComposer
          label="Comment on project"
          placeholder="Leave a comment…"
          onSend={(body) =>
            c.saveProject(props.project.id, {
              comments: [
                ...props.project.comments,
                {
                  id: crypto.randomUUID(),
                  person: 'jacob',
                  body,
                  time: 'Just now',
                },
              ],
            })
          }
        />
      </div>
    </div>
  );
}

function WorkspaceComposer(props: {
  state: TasksWorkspace;
  mount: HTMLElement;
}) {
  const c = props.state;
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [due, setDue] = createSignal('');
  const [draft, setDraft] = createSignal<WorkspaceTask>({
    id: 'draft',
    title: '',
    description: '',
    status: 'Not Started',
    priority: 'Medium',
    owner: 'jacob',
    creator: 'jacob',
    channel: c.projectId() ?? 'customers',
    tags: [],
    steps: [],
    comments: [],
  });
  const update = (patch: Partial<WorkspaceTask>) =>
    setDraft((value) => ({ ...value, ...patch }));
  return (
    <Dialog
      open
      mount={props.mount}
      position="center"
      onOpenChange={(open) => {
        if (!open) c.setComposer(undefined);
      }}
      class="tasks-native-modal"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (title().trim())
            c.create(
              { ...draft(), title: title().trim(), description: description() },
              due()
            );
        }}
      >
        <div class="flex items-center justify-between">
          <Dialog.Title class="text-sm text-ink-muted">
            {c.composer() === 'project' ? 'New project' : 'New task'}
          </Dialog.Title>
          <Dialog.CloseButton aria-label="Close composer" tabIndex={-1}>
            <X class="size-4" />
          </Dialog.CloseButton>
        </div>
        <input
          aria-label={c.composer() === 'project' ? 'Project name' : 'Task name'}
          placeholder={
            c.composer() === 'project' ? 'Project name' : 'Task name'
          }
          value={title()}
          onInput={(event) => setTitle(event.currentTarget.value)}
        />
        <textarea
          aria-label="Description"
          placeholder="Add description…"
          value={description()}
          onInput={(event) => setDescription(event.currentTarget.value)}
        />
        <div class="tasks-native-properties">
          <Show
            when={c.composer() === 'project'}
            fallback={
              <TaskStatusMenu
                task={draft()}
                onSave={(status) => update({ status })}
              />
            }
          >
            <ProjectStatus
              project={{ ...draft(), dueDate: due() }}
              save={(status) => update({ status })}
            />
          </Show>
          <TaskPriorityMenu
            task={draft()}
            onSave={(priority) => update({ priority })}
          />
          <TaskOwnerMenu task={draft()} onSave={(owner) => update({ owner })} />
          <label class="tasks-native-date tasks-native-date-input">
            <Calendar class="size-3" />
            <span>
              {due()
                ? new Date(`${due()}T12:00:00`).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })
                : 'Due date'}
            </span>
            <input
              type="date"
              aria-label="Due date"
              value={due()}
              onInput={(event) => setDue(event.currentTarget.value)}
            />
          </label>
          <Show when={c.composer() === 'task' && c.project()}>
            {(project) => (
              <span class="tasks-native-pill">
                <Stack class="size-3" />
                {project().title}
              </span>
            )}
          </Show>
        </div>
        <div class="tasks-native-composer-footer">
          <span class="text-xs text-ink-muted">Shared with Team</span>
          <Button
            type="submit"
            size="sm"
            variant="strong"
            disabled={!title().trim()}
          >
            {c.composer() === 'project' ? 'Create Project' : 'Create Task'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function AddTasks(props: { state: TasksWorkspace }) {
  const c = props.state;
  const [search, setSearch] = createSignal('');
  const [selected, setSelected] = createSignal<string[]>([]);
  const choices = () =>
    c.w.data.tasks.filter(
      (task) =>
        c.metadata[task.id]?.projectId !== c.projectId() &&
        task.title.toLowerCase().includes(search().toLowerCase())
    );
  return (
    <Dropdown
      open={c.adding()}
      placement="bottom-end"
      modal={false}
      onOpenChange={(open) => {
        if (open) {
          setSearch('');
          setSelected([]);
        }
        c.setAdding(open);
      }}
    >
      <Dropdown.Trigger size="sm" variant="outline">
        Add existing tasks
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="tasks-native-add-dropdown">
        <input
          aria-label="Find tasks to add"
          placeholder="Search tasks…"
          value={search()}
          onInput={(event) => setSearch(event.currentTarget.value)}
          onKeyDown={(event) => event.stopPropagation()}
        />
        <div class="tasks-native-add-list">
          <For each={choices()}>
            {(task) => (
              <Dropdown.CheckboxItem
                checked={selected().includes(task.id)}
                onChange={() =>
                  setSelected((ids) =>
                    ids.includes(task.id)
                      ? ids.filter((id) => id !== task.id)
                      : [...ids, task.id]
                  )
                }
              >
                {task.title}
              </Dropdown.CheckboxItem>
            )}
          </For>
        </div>
        <div
          class="tasks-native-composer-footer"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Button size="sm" onClick={() => c.setAdding(false)}>
            Cancel
          </Button>
          <Button
            variant="strong"
            size="sm"
            disabled={!selected().length}
            onClick={() => {
              for (const id of selected()) c.assignProject(id, c.projectId()!);
              c.setAdding(false);
            }}
          >
            Add {selected().length} {selected().length === 1 ? 'task' : 'tasks'}
          </Button>
        </div>
      </Dropdown.Content>
    </Dropdown>
  );
}

export function TasksWorkspaceMain(props: { state: TasksWorkspace }) {
  const c = props.state;
  let root!: HTMLDivElement;
  const [sharing, setSharing] = createSignal(false);
  const [details, setDetails] = createSignal(false);
  const location = () =>
    c.tab() === 'mine'
      ? 'My Tasks'
      : c.tab() === 'created'
        ? 'Created by me'
        : c.tab() === 'projects'
          ? 'Projects'
          : 'All Tasks';
  const navigation = () => (
    <>
      <button
        type="button"
        class="tasks-native-breadcrumb"
        onClick={() => c.navigate(c.tab())}
      >
        {location()}
      </button>
      <Show when={c.project()}>
        {(project) => (
          <>
            <Caret class="size-3" />
            <button
              type="button"
              class="tasks-native-breadcrumb"
              onClick={() => {
                c.back();
                c.setSection('tasks');
              }}
            >
              <Stack class="size-3" />
              {project().title}
            </button>
          </>
        )}
      </Show>
      <Show when={c.task()}>
        <Caret class="size-3" />
      </Show>
    </>
  );
  return (
    <div
      ref={root}
      class="tasks-native-main"
      onKeyDown={(event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape' && details()) {
          setDetails(false);
          event.stopPropagation();
          return;
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
          event.preventDefault();
          const search = root.querySelector<HTMLInputElement>(
            'input[type="search"]'
          );
          if (search) search.focus();
          else
            root
              .querySelector<HTMLButtonElement>('[data-project-search-trigger]')
              ?.click();
        }
        if (event.key === 'Escape' && c.task() && !c.composer() && !sharing()) {
          const id = c.task()!.id;
          c.back();
          queueMicrotask(() =>
            root
              .querySelector<HTMLButtonElement>(`[data-open-task="${id}"]`)
              ?.focus()
          );
        }
      }}
    >
      <Show
        when={c.task()}
        fallback={
          <>
            <ViewShell.TopBar>
              {navigation()}
              <Show when={c.project()}>
                <TabsInset
                  aria-label="Project sections"
                  list={[
                    { value: 'overview', label: 'Overview' },
                    { value: 'tasks', label: 'Tasks' },
                  ]}
                  value={c.section()}
                  onChange={(value) =>
                    c.setSection(value === 'tasks' ? 'tasks' : 'overview')
                  }
                />
                <Button
                  class="ml-auto"
                  variant="plain"
                  size="sm"
                  onClick={() => setSharing(true)}
                >
                  Share
                </Button>
                <PanelToggle open={details()} onChange={setDetails} />
              </Show>
            </ViewShell.TopBar>
            <Show when={!c.projectId()}>
              <div class="tasks-native-mobile-tabs">
                <For
                  each={[
                    { id: 'mine' as const, label: 'My Tasks' },
                    { id: 'all' as const, label: 'All Tasks' },
                    { id: 'created' as const, label: 'Created by me' },
                    { id: 'projects' as const, label: 'Projects' },
                  ]}
                >
                  {(item) => (
                    <button
                      type="button"
                      aria-pressed={c.tab() === item.id && !c.projectId()}
                      onClick={() => c.navigate(item.id)}
                    >
                      {item.label}
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show
              when={c.project() && c.section() === 'overview'}
              fallback={
                <>
                  <TasksWorkspaceControls
                    state={c}
                    actions={
                      <Show when={c.projectId()}>
                        <AddTasks state={c} />
                        <Button size="sm" onClick={() => c.setComposer('task')}>
                          New task
                        </Button>
                      </Show>
                    }
                  />
                  <TasksGrid state={c} />
                </>
              }
            >
              <ProjectOverview state={c} project={c.project()!} />
            </Show>
          </>
        }
      >
        {(task) => (
          <TaskNotebook
            workspace={{
              ...c.w,
              updateTask: c.saveTask,
              backToCollection: c.back,
            }}
            task={task()}
            hideCollectionNavigation
            sourceContent={
              !c.w.data.channels.some((channel) =>
                channel.messages.some((message) => message.taskId === task().id)
              ) ? (
                <span />
              ) : undefined
            }
            navigation={navigation()}
            onShare={() => setSharing(true)}
            pills={
              <>
                <TaskProjectPicker state={c} taskId={task().id} />
                <DateValue value={c.metadata[task().id]?.dueDate} />
              </>
            }
          />
        )}
      </Show>
      <Show when={c.composer()}>
        <WorkspaceComposer state={c} mount={root} />
      </Show>
      <Show when={details() && c.project() && !c.task()}>
        <aside class="tasks-native-details" aria-label="Project details">
          <div class="flex items-center justify-between">
            <h2>Properties</h2>
            <Button
              variant="plain"
              size="icon-sm"
              label="Close project details"
              onClick={() => setDetails(false)}
            >
              <X />
            </Button>
          </div>
          <p class="text-xs text-ink-muted">Status</p>
          <ProjectStatus
            project={c.project()!}
            save={(status) => c.saveProject(c.projectId()!, { status })}
          />
          <p class="text-xs text-ink-muted">Priority</p>
          <TaskPriorityMenu
            task={c.project()!}
            onSave={(priority) => c.saveProject(c.projectId()!, { priority })}
          />
          <p class="text-xs text-ink-muted">Assignees</p>
          <TaskOwnerMenu
            task={c.project()!}
            onSave={(owner) => c.saveProject(c.projectId()!, { owner })}
          />
          <p class="text-xs text-ink-muted">Due date</p>
          <DateValue value={c.project()?.dueDate} />
        </aside>
      </Show>
      <DocumentShareSheet
        open={sharing()}
        title={c.task()?.title ?? c.project()?.title ?? location()}
        entityLabel={c.task() ? 'task' : 'project'}
        onClose={() => setSharing(false)}
      />
    </div>
  );
}
