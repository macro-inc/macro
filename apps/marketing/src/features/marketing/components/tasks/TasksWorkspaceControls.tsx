import Check from '@phosphor/check.svg';
import Filter from '@phosphor/funnel-simple.svg';
import Board from '@phosphor/kanban.svg';
import List from '@phosphor/list-bullets.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import Sort from '@phosphor/sort-ascending.svg';
import Stack from '@phosphor/stack.svg';
import X from '@phosphor/x.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import { homepagePeople } from '../../core/homepage-demo-people';
import { SearchBar } from '../email/frozen/SearchBar';
import {
  type GroupBy,
  priorities,
  projectStatuses,
  type TasksWorkspace,
  taskStatuses,
} from './createTasksWorkspace';

/** Presentation from view-shell/ListDropdowns; commands stay in this demo. */
export function NativeMenu<T extends string>(props: {
  label: string;
  icon: JSX.Element;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  children?: JSX.Element;
}) {
  return (
    <Dropdown placement="bottom-end" modal={false}>
      <Dropdown.Trigger variant="ghost" size="icon-md" label={props.label}>
        {props.icon}
        {props.children}
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="min-w-40">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={props.value}
            onChange={(value) => {
              const next = props.options.find((item) => item === value);
              if (next) props.onChange(next);
            }}
          >
            <For each={props.options}>
              {(option) => (
                <Dropdown.RadioItem closeOnSelect value={option}>
                  <span class="flex-1">{option}</span>
                  <Dropdown.ItemIndicator>
                    <Check class="size-3.5 text-accent" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

/** ProjectTaskSearch from the app: expand in place; Escape clears and closes. */
function ProjectTaskSearch(props: { state: TasksWorkspace }) {
  const c = props.state;
  const [expanded, setExpanded] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  let input: HTMLInputElement | undefined;
  const label = () => `Search in ${c.project()?.title ?? 'project'}`;
  const close = () => {
    c.setSearch('');
    setExpanded(false);
    queueMicrotask(() => trigger?.focus());
  };
  return (
    <Show
      when={expanded()}
      fallback={
        <Button
          ref={trigger}
          variant="outline"
          size="icon-md"
          label={label()}
          data-project-search-trigger
          aria-expanded={false}
          onClick={() => {
            setExpanded(true);
            queueMicrotask(() => input?.focus());
          }}
        >
          <SearchIcon />
        </Button>
      }
    >
      <div class="tasks-native-project-search">
        <SearchIcon class="size-3.5" />
        <input
          ref={input}
          type="search"
          aria-label={label()}
          placeholder={label()}
          value={c.search()}
          onInput={(event) => c.setSearch(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        />
        <Button
          variant="plain"
          size="icon-sm"
          label="Close project search"
          onClick={close}
        >
          <X />
        </Button>
      </div>
    </Show>
  );
}

export function TasksWorkspaceControls(props: {
  state: TasksWorkspace;
  actions?: JSX.Element;
}) {
  const c = props.state;
  const [filterOpen, setFilterOpen] = createSignal(false);
  const [filterText, setFilterText] = createSignal('');
  const [filterError, setFilterError] = createSignal(false);
  const filterGroups = () => [
    {
      key: 'status' as const,
      label: 'Status',
      values: c.projectList() ? projectStatuses : taskStatuses,
    },
    { key: 'priority' as const, label: 'Priority', values: priorities },
    {
      key: 'owner' as const,
      label: 'Assignee',
      values: ['jacob', 'julia', 'teo', 'gabriel'],
    },
  ];
  const filterLabel = (key: string, value: string) =>
    key === 'owner'
      ? homepagePeople[value as keyof typeof homepagePeople].shortName
      : value;
  const applyText = () => {
    const text = filterText().toLowerCase();
    const status = taskStatuses.filter((value) =>
      text.includes(value.toLowerCase())
    );
    const priority = priorities.filter((value) =>
      text.includes(value.toLowerCase())
    );
    const owner = ['jacob', 'julia', 'teo', 'gabriel'].filter((value) =>
      text.includes(value)
    );
    if (!status.length && !priority.length && !owner.length) {
      setFilterError(true);
      return;
    }
    c.setFilters({
      status: text.includes('not completed')
        ? taskStatuses.filter((value) => value !== 'Completed')
        : [...status],
      priority: [...priority],
      owner,
      tag: '',
    });
    setFilterOpen(false);
    setFilterError(false);
  };
  return (
    <div class="tasks-native-toolbar" data-project={!!c.projectId()}>
      <Show
        when={c.projectId()}
        fallback={
          <SearchBar
            label={
              c.projectList()
                ? 'Search projects'
                : c.projectId()
                  ? 'Search project tasks'
                  : 'Search tasks'
            }
            placeholder={c.projectList() ? 'Search projects' : 'Search tasks'}
            value={c.search()}
            onValueChange={c.setSearch}
            hotkey="cmd+f"
            class="min-w-0 flex-1 max-w-md"
          />
        }
      >
        <ProjectTaskSearch state={c} />
      </Show>
      <div class="tasks-native-controls">
        <Show when={!c.projectList()}>
          <NativeMenu
            label="Task layout"
            icon={c.layout() === 'Board' ? <Board /> : <List />}
            value={c.layout()}
            options={['List', 'Board']}
            onChange={(value) => {
              c.setLayout(value);
              if (value === 'Board' && c.group() === 'None')
                c.setGroup('Status');
            }}
          />
        </Show>
        <NativeMenu
          label={c.projectList() ? 'Sort projects' : 'Sort tasks'}
          icon={<Sort />}
          value={c.sort()}
          options={['Updated', 'Created']}
          onChange={c.setSort}
        />
        <NativeMenu
          label={c.projectList() ? 'Group projects' : 'Group by'}
          icon={<Stack />}
          value={c.group()}
          options={
            [
              'None',
              'Status',
              'Priority',
              'Assignee',
              ...(!c.projectList() ? ['Project'] : []),
            ] as GroupBy[]
          }
          onChange={c.setGroup}
        />
        <Dropdown
          open={filterOpen()}
          onOpenChange={setFilterOpen}
          placement="bottom-end"
          modal={false}
        >
          <Dropdown.Trigger
            variant="ghost"
            size="icon-md"
            label={c.projectList() ? 'Filter projects' : 'Filter tasks'}
            class="relative"
          >
            <Filter />
            <Show
              when={
                c.filters.status.length +
                c.filters.priority.length +
                c.filters.owner.length
              }
            >
              <span class="tasks-native-filter-count">
                {c.filters.status.length +
                  c.filters.priority.length +
                  c.filters.owner.length}
              </span>
            </Show>
          </Dropdown.Trigger>
          <Dropdown.Content portalScope="local" class="w-60">
            <Show when={!c.projectList()}>
              <div class="px-2 pb-2">
                <input
                  class="tasks-native-ai-filter"
                  aria-label="Filter with AI"
                  placeholder="Filter with AI…"
                  value={filterText()}
                  onInput={(event) => setFilterText(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyText();
                    }
                  }}
                />
                <Show when={filterError()}>
                  <p class="text-xs text-ink-muted">
                    Try a status, priority, or person.
                  </p>
                </Show>
              </div>
            </Show>
            <For each={filterGroups()}>
              {(group) => (
                <Dropdown.Sub>
                  <Dropdown.SubTrigger>{group.label}</Dropdown.SubTrigger>
                  <Dropdown.SubContent portalScope="local">
                    <Dropdown.Group>
                      <For each={group.values}>
                        {(value) => (
                          <Dropdown.CheckboxItem
                            checked={c.filters[group.key].includes(value)}
                            onChange={() => c.toggleFilter(group.key, value)}
                          >
                            {filterLabel(group.key, value)}
                          </Dropdown.CheckboxItem>
                        )}
                      </For>
                    </Dropdown.Group>
                  </Dropdown.SubContent>
                </Dropdown.Sub>
              )}
            </For>
            <Dropdown.Separator />
            <Dropdown.Item
              onSelect={() => {
                c.clear();
                setFilterText('');
              }}
            >
              Clear filters
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown>
        {props.actions}
      </div>
    </div>
  );
}
