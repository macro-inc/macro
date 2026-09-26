import { useListInteractions } from '@app/components/list';
import { ListViewport } from '@app/components/list/ListViewport';
import {
  ListFilterDropdown,
  type ListFilterGroup,
  ListGroupDropdown,
  ListSortDropdown,
  SearchBar,
  useViewControlHotkeys,
  ViewShell,
} from '@app/components/view-shell';
import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import { TaskGroupHeader } from '@app/features/tasks-view/components/task-list/TaskGroupHeader';
import { EntitySelectionToolbarModal } from '@entity/EntitySelectionToolbarModal';
import CalendarIcon from '@phosphor/calendar.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { Button, Dropdown, Input } from '@ui';
import { type Accessor, createSignal, Match, Show, Switch } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import { ProjectListHeader, ProjectRow } from '../components/project-row';
import { useProjectsContext } from '../context/projects-context';
import type {
  createProjectCollection,
  ProjectListActivation,
} from '../primitives/project-collection';

type FilterGroup = 'status' | 'priority' | 'assignee';

export function ProjectsCollection(props: {
  onOpen(id: string, metadata?: ProjectListActivation): void;
  onCreate(): void;
  scopeId: string;
  isActive: Accessor<boolean>;
  collection: ReturnType<typeof createProjectCollection>;
}) {
  const context = useProjectsContext();
  const collection = props.collection;
  const commands = context.createCommands();
  const definitions = context.createPropertyDefinitionsSource();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  let grid: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  const [openMenu, setOpenMenu] = createSignal<'filters' | 'sort'>();
  const filters = (): ListFilterGroup<FilterGroup, string>[] => [
    ...(['status', 'priority'] as const).map((id) => ({
      id,
      label: id === 'status' ? 'Status' : 'Priority',
      selectionMode: 'single' as const,
      options:
        definitions
          .properties()
          .find(
            (property) =>
              property.propertyDefinitionId ===
              (id === 'status'
                ? SYSTEM_PROPERTY_IDS.STATUS
                : SYSTEM_PROPERTY_IDS.PRIORITY)
          )
          ?.options?.flatMap((option) =>
            option.value.type === 'string'
              ? [
                  {
                    id: option.id,
                    label: option.value.value,
                    icon: () => (
                      <PropertyValueIcon
                        optionId={option.id}
                        class="size-3.5"
                      />
                    ),
                  },
                ]
              : []
          ) ?? [],
    })),
    {
      id: 'assignee',
      label: 'Assignee',
      selectionMode: 'single',
      options: [{ id: 'me', label: 'Assigned to me' }],
    },
  ];
  const clearFilters = () => {
    collection.setStatus('');
    collection.setPriority('');
    collection.setMine(false);
    collection.setDueAfter('');
    collection.setDueBefore('');
  };
  const activeCount = () =>
    Number(Boolean(collection.status())) +
    Number(Boolean(collection.priority())) +
    Number(collection.mine()) +
    Number(Boolean(collection.dueAfter() || collection.dueBefore()));
  const filtered = () => Boolean(collection.search().trim() || activeCount());
  const list = collection.list;
  const interaction = useListInteractions({
    controller: list,
    scopeId: props.scopeId,
    enabled: props.isActive,
    scrollHandle: virtualizer,
    activation: {
      createMetadata: (intent) => ({ newSplit: intent === 'alternate' }),
      alternateDescription: 'Open project in new split',
    },
    disclosure: {
      getKey: (row) =>
        row.kind === 'section-header' ? undefined : row.groupId,
      isExpanded: collection.disclosure.isExpanded,
      setExpanded: collection.disclosure.setExpanded,
      getFocusKey: (groupId) =>
        collection
          .items()
          .find((row) => row.kind === 'group-header' && row.groupId === groupId)
          ?.id,
    },
    navigation: {
      onNavigate: (event) => {
        if (
          event.kind === 'move' &&
          event.direction === 1 &&
          collection.hasMore() &&
          !collection.loadingMore() &&
          (!event.result || list.items.count() - event.result.index <= 4)
        )
          void collection.loadMore();
      },
    },
  });
  useViewControlHotkeys({
    scopeId: props.scopeId,
    enabled: props.isActive,
    search: {
      description: 'Search projects',
      run: () => {
        searchInput?.focus();
        return true;
      },
    },
    filter: {
      description: 'Filter projects',
      run: () => {
        setOpenMenu('filters');
        return true;
      },
    },
    sort: {
      description: 'Sort projects',
      run: () => {
        setOpenMenu('sort');
        return true;
      },
    },
  });
  const checkNearEnd = () => {
    const handle = virtualizer();
    if (handle) collection.setScrollOffset(handle.scrollOffset);
    if (
      handle &&
      handle.scrollSize - handle.scrollOffset - handle.viewportSize < 300 &&
      collection.hasMore() &&
      !collection.loadingMore()
    )
      void collection.loadMore();
  };
  const sourceError = () => {
    const state = collection.state();
    return state.kind === 'error' ? state.error : undefined;
  };
  const backgroundError = () => {
    const state = collection.state();
    return state.kind === 'ready' ? state.backgroundError : undefined;
  };
  return (
    <>
      <ViewShell.Header>
        <div class="flex min-w-0 flex-col gap-3">
          <div class="hidden h-8 min-w-0 items-center touch:flex @max-[720px]/view-shell:flex">
            <h1 class="min-w-0 truncate text-xl font-semibold tracking-[-0.03em] text-ink">
              Projects
            </h1>
            <div class="ml-auto shrink-0">
              <SidebarCreateButton label="New" onCreate={props.onCreate} />
            </div>
          </div>
          <div class="flex min-w-0 items-center justify-between gap-3">
            <SearchBar
              ref={(element) => {
                searchInput = element;
              }}
              label="Search projects"
              placeholder="Search projects"
              value={collection.search()}
              onValueChange={collection.setSearch}
              onEscape={() => grid?.focus()}
              class="max-w-md flex-1"
              hotkey="cmd+f"
            />
            <div class="flex shrink-0 items-center gap-2">
              <ListSortDropdown
                label="Sort projects"
                value={collection.sort()}
                options={[
                  { id: 'updated', label: 'Updated' },
                  { id: 'name', label: 'Name' },
                  { id: 'due', label: 'Due date' },
                ]}
                onChange={collection.setSort}
                open={openMenu() === 'sort'}
                onOpenChange={(open) => setOpenMenu(open ? 'sort' : undefined)}
              />
              <ListGroupDropdown
                label="Group projects"
                value={collection.groupBy()}
                options={[
                  { id: 'none', label: 'None' },
                  { id: 'status', label: 'Status' },
                  { id: 'priority', label: 'Priority' },
                  { id: 'assignee', label: 'Assignee' },
                ]}
                onChange={collection.setGroupBy}
              />
              <div class="relative shrink-0">
                <ListFilterDropdown
                  label="Filter projects"
                  groups={filters()}
                  open={openMenu() === 'filters'}
                  onOpenChange={(open) =>
                    setOpenMenu(open ? 'filters' : undefined)
                  }
                  isSelected={(group, id) =>
                    group === 'assignee'
                      ? collection.mine()
                      : (group === 'status'
                          ? collection.status()
                          : collection.priority()) === id
                  }
                  onSelectionChange={(group, id, selected) => {
                    if (group === 'assignee') collection.setMine(selected);
                    else if (group === 'status')
                      collection.setStatus(selected ? id : '');
                    else collection.setPriority(selected ? id : '');
                  }}
                  onClear={clearFilters}
                />
                <Show when={activeCount()}>
                  <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
                    {activeCount()}
                  </span>
                </Show>
              </div>
              <Dropdown>
                <Dropdown.Trigger
                  variant="outline"
                  size="md"
                  square
                  depth={2}
                  class="rounded-lg bg-surface"
                  label="Filter due date"
                >
                  <CalendarIcon />
                </Dropdown.Trigger>
                <Dropdown.Content>
                  <div class="flex flex-col gap-3 p-2">
                    <label class="flex flex-col gap-1 text-xs">
                      From
                      <Input
                        type="date"
                        value={collection.dueAfter()}
                        onInput={(event) =>
                          collection.setDueAfter(event.currentTarget.value)
                        }
                      />
                    </label>
                    <label class="flex flex-col gap-1 text-xs">
                      Through
                      <Input
                        type="date"
                        value={collection.dueBefore()}
                        onInput={(event) =>
                          collection.setDueBefore(event.currentTarget.value)
                        }
                      />
                    </label>
                    <Button
                      size="sm"
                      onClick={() => {
                        collection.setDueAfter('');
                        collection.setDueBefore('');
                      }}
                    >
                      Clear dates
                    </Button>
                  </div>
                </Dropdown.Content>
              </Dropdown>
            </div>
          </div>
        </div>
      </ViewShell.Header>
      <ViewShell.Content>
        <div
          ref={(element) => {
            grid = element;
          }}
          role="grid"
          aria-label="Projects"
          aria-multiselectable="true"
          aria-activedescendant={list.focus.key()}
          tabIndex={0}
          class="@container/u-list relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden outline-none"
        >
          <ProjectListHeader />
          <Show when={backgroundError()}>
            <p role="status" class="px-3 text-xs text-ink-muted">
              Could not refresh projects. Showing the last loaded list.
            </p>
          </Show>
          <Switch>
            <Match when={collection.state().kind === 'loading'}>
              <div class="grid flex-1 place-items-center text-ink-muted">
                <SpinnerIcon
                  class="size-5 animate-spin"
                  aria-label="Loading projects"
                />
              </div>
            </Match>
            <Match when={sourceError()}>
              <div
                role="alert"
                class="grid flex-1 place-items-center gap-3 text-sm text-ink-muted"
              >
                <span>Projects couldn’t be loaded.</span>
                <Button onClick={() => void collection.refresh()}>
                  Try again
                </Button>
              </div>
            </Match>
            <Match when={collection.items().length === 0}>
              <div class="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted">
                <span>
                  {filtered() ? 'No matching projects' : 'No projects yet'}
                </span>
                <Show when={!filtered()}>
                  <Button onClick={props.onCreate}>New project</Button>
                </Show>
              </div>
            </Match>
            <Match when={true}>
              <ListViewport
                ref={(handle) => {
                  setVirtualizer(handle);
                  handle?.scrollTo(collection.scrollOffset());
                }}
                items={collection.items()}
                focusedIndex={list.focus.index()}
                onScroll={checkNearEnd}
              >
                {(row) => (
                  <Switch>
                    <Match when={row.kind === 'group-header' ? row : undefined}>
                      {(group) => (
                        <TaskGroupHeader
                          row={group()}
                          groupBy={collection.groupBy()}
                          expanded={collection.disclosure.isExpanded(
                            group().groupId
                          )}
                          focused={list.focus.key() === group().id}
                          onFocus={() =>
                            list.focus.set(group().id, { reason: 'hover' })
                          }
                          onToggle={() =>
                            list.activate.key(group().id, { reason: 'pointer' })
                          }
                        />
                      )}
                    </Match>
                    <Match when={row.kind === 'entity' ? row : undefined}>
                      {(item) => (
                        <ProjectRow
                          rowId={item().id}
                          row={item().entity}
                          highlighted={list.focus.key() === item().id}
                          checked={list.selection.isSelected(item().id)}
                          onFocus={() =>
                            list.focus.set(item().id, { reason: 'hover' })
                          }
                          onChecked={(selected, range) =>
                            interaction.selection.set(item().id, selected, {
                              range,
                            })
                          }
                          onOpen={(event) => {
                            if (event.ctrlKey || event.metaKey)
                              interaction.selection.toggle(item().id);
                            else
                              list.activate.key(item().id, {
                                reason: 'pointer',
                                metadata: { event, newSplit: event.shiftKey },
                              });
                          }}
                          onSave={(property, value) =>
                            commands.saveProperty(
                              item().entity.id,
                              property,
                              value
                            )
                          }
                        />
                      )}
                    </Match>
                    <Match when={row.kind === 'load-more' ? row : undefined}>
                      {(more) => (
                        <div role="row" id={more().id}>
                          <div
                            role="gridcell"
                            aria-colspan={8}
                            class="flex justify-center py-2"
                          >
                            <Button
                              disabled={collection.loadingMore()}
                              onClick={() =>
                                list.activate.key(more().id, {
                                  reason: 'pointer',
                                })
                              }
                            >
                              {collection.loadingMore()
                                ? 'Loading…'
                                : 'Load more projects'}
                            </Button>
                          </div>
                        </div>
                      )}
                    </Match>
                  </Switch>
                )}
              </ListViewport>
            </Match>
          </Switch>
          <Show when={list.selection.count()}>
            <EntitySelectionToolbarModal
              selectedCount={list.selection.count()}
              onClose={interaction.selection.clear}
            />
          </Show>
        </div>
      </ViewShell.Content>
    </>
  );
}
