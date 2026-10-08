import { Gantt } from '@app/components/gantt/gantt';
import { useListInteractions } from '@app/components/list';
import { ListViewport } from '@app/components/list/ListViewport';
import {
  ListFilterDropdown,
  type ListFilterGroup,
  ListGroupDropdown,
  ListSortDropdown,
  SearchBar,
  useViewControlHotkeys,
  ViewLayoutDropdown,
  ViewShell,
} from '@app/components/view-shell';
import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import {
  getSoupMenuEntities,
  getSoupRowEntities,
} from '@app/features/soup/collection/rows';
import { TaskGroupHeader } from '@app/features/tasks-view/components/task-list/TaskGroupHeader';
import { taskGridColumnCount } from '@app/features/tasks-view/components/task-list/task-grid-template';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EntitySelectionToolbarModal } from '@entity/EntitySelectionToolbarModal';
import CalendarIcon from '@phosphor/calendar.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property, PropertyApiValues } from '@property/types';
import { Button, Dropdown, Input } from '@ui';
import {
  type Accessor,
  batch,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import { DeleteProjectsDialog } from '../components/delete-projects-dialog';
import { ProjectListHeader, ProjectRow } from '../components/project-row';
import { ProjectRowMenu } from '../components/project-row-menu';
import { RenameProjectDialog } from '../components/rename-project-dialog';
import {
  type ProjectRow as ProjectRowData,
  useProjectsContext,
} from '../context/projects-context';
import { canEditProject } from '../core/project';
import type { ProjectComposerDraft } from '../primitives/create-project';
import type {
  createProjectCollection,
  ProjectListActivation,
  ProjectListEntity,
} from '../primitives/project-collection';
import { projectTimelineDates } from '../queries/project-timeline';
import { ProjectsGantt } from './projects-gantt';

type FilterGroup = 'status' | 'priority' | 'assignee';

export function ProjectsCollection(props: {
  onOpen(id: string, metadata?: ProjectListActivation): void;
  createAssigneeName: (id: Accessor<string>) => Accessor<string>;
  onCreate(draft?: ProjectComposerDraft): void;
  scopeId: string;
  isActive: Accessor<boolean>;
  collection: ReturnType<typeof createProjectCollection>;
  /** Whether the layout has room to open a project beside the list. */
  canOpenInNewSplit: Accessor<boolean>;
  onCopyLink(id: string): void;
  onCopyId(id: string): void;
  /** Omit where the host cannot show the project's Share menu. */
  onShare?(id: string): void;
}) {
  const context = useProjectsContext();
  const collection = props.collection;
  const commands = context.createCommands();
  const definitions = context.createPropertyDefinitionsSource();
  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();
  let grid: HTMLDivElement | undefined;
  let timeline: HTMLDivElement | undefined;
  let searchInput: HTMLInputElement | undefined;
  const [openMenu, setOpenMenu] = createSignal<'filters' | 'sort'>();
  const isGantt = () => !isTouchDevice() && collection.layout() === 'gantt';
  const definition = (id: string) =>
    definitions
      .properties()
      .find((property) => property.propertyDefinitionId === id);
  const filters = (): ListFilterGroup<FilterGroup, string>[] => [
    ...(['status', 'priority'] as const).map((id) => ({
      id,
      label: id === 'status' ? 'Status' : 'Priority',
      selectionMode: 'single' as const,
      options:
        definition(
          id === 'status'
            ? SYSTEM_PROPERTY_IDS.STATUS
            : SYSTEM_PROPERTY_IDS.PRIORITY
        )?.options?.flatMap((option) =>
          option.value.type === 'string'
            ? [
                {
                  id: option.id,
                  label: option.value.value,
                  icon: () => (
                    <PropertyValueIcon optionId={option.id} class="size-3.5" />
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
    enabled: () => props.isActive() && !isGantt(),
    scrollHandle: virtualizer,
    activation: {
      createMetadata: (intent) => ({ newSplit: intent === 'alternate' }),
      alternateDescription: 'Open project in new split',
    },
    disclosure: {
      isHeader: (row) => row.kind === 'group-header',
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
  const [renaming, setRenaming] = createSignal<ProjectRowData>();
  const [deleting, setDeleting] = createSignal<{
    rows: readonly ProjectRowData[];
    error?: string;
  }>();
  const [deletePending, setDeletePending] = createSignal(false);
  // The menu entry that opened a dialog no longer exists when it closes.
  const returnFocusToList = (event: Event) => {
    event.preventDefault();
    if (isGantt())
      timeline?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    else grid?.focus();
  };
  const menuTargets = (entity: ProjectListEntity) =>
    getSoupMenuEntities(entity, getSoupRowEntities(list.selection.items()));
  const canEditDueDate = (entity: ProjectListEntity) => {
    const property = definition(SYSTEM_PROPERTY_IDS.DUE_DATE);
    return (
      canEditProject(entity.project) &&
      property?.valueType === 'DATE' &&
      !property.isMetadata &&
      !commands.pending()
    );
  };
  const saveDueDate = async (id: string, date: Date) => {
    const row = collection
      .items()
      .find((item) => item.kind === 'entity' && item.entity.id === id);
    const property = definition(SYSTEM_PROPERTY_IDS.DUE_DATE);
    try {
      if (row?.kind !== 'entity' || !property || !canEditDueDate(row.entity))
        throw new Error('Project is no longer editable');
      await commands.saveProperty(id, property, {
        valueType: 'DATE',
        value: date,
      });
    } catch (error) {
      toast.failure('Could not update due date');
      throw error;
    }
  };
  const createOnTimeline = (date: Date) => {
    const property = definition(SYSTEM_PROPERTY_IDS.DUE_DATE);
    if (!property || property.valueType !== 'DATE') return;
    props.onCreate({
      name: '',
      description: '',
      shareWithTeam: true,
      properties: [{ property, value: { valueType: 'DATE', value: date } }],
    });
  };
  function ProjectMenu(menu: {
    entity: ProjectListEntity;
    rowId?: string;
    children: JSX.Element;
  }) {
    return (
      <ProjectRowMenu
        targets={() => (isGantt() ? [menu.entity] : menuTargets(menu.entity))}
        status={definition(SYSTEM_PROPERTY_IDS.STATUS)}
        priority={definition(SYSTEM_PROPERTY_IDS.PRIORITY)}
        canOpenInNewSplit={props.canOpenInNewSplit()}
        onOpenInNewSplit={(row) =>
          props.onOpen(row.project.id, { newSplit: true })
        }
        onRename={(row) => setRenaming(row)}
        onSetOption={(rows, property, optionId) =>
          void setOption(rows, property, optionId)
        }
        onCopyLink={(row) => props.onCopyLink(row.project.id)}
        onCopyId={(row) => props.onCopyId(row.project.id)}
        onShare={props.onShare && ((row) => props.onShare?.(row.project.id))}
        onDelete={(rows) => setDeleting({ rows })}
        onOpenChange={(open) => {
          if (!open || isGantt() || !menu.rowId) return;
          list.focus.set(menu.rowId, { reason: 'pointer', force: true });
          list.selection.setAnchor(menu.rowId);
        }}
        onCloseAutoFocus={(event) => {
          if (renaming() || deleting()) event.preventDefault();
        }}
      >
        {menu.children}
      </ProjectRowMenu>
    );
  }
  const setOption = async (
    rows: readonly ProjectRowData[],
    property: Property,
    optionId: string
  ) => {
    const value: PropertyApiValues = {
      valueType: 'SELECT_STRING',
      values: [optionId],
    };
    try {
      await commands.saveProperties(
        rows.map((row) => ({
          id: row.project.id,
          // A row's own value saves exactly like editing its cell.
          property:
            row.properties.find(
              (current) =>
                current.propertyDefinitionId === property.propertyDefinitionId
            ) ?? property,
          value,
        }))
      );
    } catch (error) {
      console.error('Failed to update projects', error);
      const name = property.displayName.toLowerCase();
      toast.failure(
        rows.length === 1
          ? `Could not update ${name}`
          : `Could not update ${name} for every project`
      );
    }
  };
  const deleteProjects = async (rows: readonly ProjectRowData[]) => {
    setDeletePending(true);
    let failedIds: readonly string[];
    try {
      failedIds = await commands.deleteMany(rows.map((row) => row.project.id));
    } catch (error) {
      console.error('Failed to delete projects', error);
      failedIds = rows.map((row) => row.project.id);
    } finally {
      setDeletePending(false);
    }
    const failed = rows.filter((row) => failedIds.includes(row.project.id));
    batch(() => {
      for (const row of rows)
        if (!failed.includes(row)) list.selection.deselectKey(row.project.id);
    });
    if (failed.length === 0) {
      setDeleting(undefined);
      toast.success(
        rows.length > 1 ? `Deleted ${rows.length} projects` : 'Project deleted'
      );
      return;
    }
    // Only the failures remain for a retry.
    setDeleting({
      rows: failed,
      error:
        failed.length === rows.length
          ? 'Could not delete. Please try again.'
          : `Deleted ${rows.length - failed.length} of ${rows.length}. The rest could not be deleted.`,
    });
  };
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
              <SidebarCreateButton
                label="New"
                onCreate={() => props.onCreate()}
              />
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
              <Show when={!isTouchDevice()}>
                <ViewLayoutDropdown
                  label="Project layout"
                  layouts={['list', 'gantt']}
                  value={collection.layout()}
                  onChange={(layout) => {
                    if (layout !== 'board') collection.setLayout(layout);
                  }}
                />
              </Show>
              <ListSortDropdown
                label="Sort projects"
                value={collection.sort()}
                options={[
                  { id: 'updated', label: 'Updated' },
                  { id: 'created', label: 'Created' },
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
                  variant="ghost"
                  size="md"
                  square
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
              <Button
                variant="outline"
                class="touch:hidden @max-[720px]/view-shell:hidden"
                onClick={() => props.onCreate()}
              >
                <PlusIcon class="size-4" />
                New project
              </Button>
            </div>
          </div>
        </div>
      </ViewShell.Header>
      <ViewShell.Content>
        <Show
          when={isGantt()}
          fallback={
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
                      <Button onClick={() => props.onCreate()}>
                        New project
                      </Button>
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
                        <Match
                          when={row.kind === 'group-header' ? row : undefined}
                        >
                          {(group) => (
                            <TaskGroupHeader
                              row={group()}
                              columnCount={taskGridColumnCount(true)}
                              groupBy={collection.groupBy()}
                              expanded={collection.disclosure.isExpanded(
                                group().groupId
                              )}
                              focused={list.focus.key() === group().id}
                              onFocus={() =>
                                list.focus.set(group().id, {
                                  reason: 'hover',
                                })
                              }
                              onToggle={() =>
                                list.activate.key(group().id, {
                                  reason: 'pointer',
                                })
                              }
                            />
                          )}
                        </Match>
                        <Match when={row.kind === 'entity' ? row : undefined}>
                          {(item) => (
                            <ProjectMenu
                              entity={item().entity}
                              rowId={item().id}
                            >
                              <ProjectRow
                                rowId={item().id}
                                row={item().entity}
                                highlighted={list.focus.key() === item().id}
                                checked={list.selection.isSelected(item().id)}
                                onFocus={() =>
                                  list.focus.set(item().id, {
                                    reason: 'hover',
                                  })
                                }
                                onChecked={(selected, range) =>
                                  interaction.selection.set(
                                    item().id,
                                    selected,
                                    {
                                      range,
                                    }
                                  )
                                }
                                onOpen={(event) => {
                                  if (event.ctrlKey || event.metaKey)
                                    interaction.selection.toggle(item().id);
                                  else
                                    list.activate.key(item().id, {
                                      reason: 'pointer',
                                      metadata: {
                                        event,
                                        newSplit: event.shiftKey,
                                      },
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
                            </ProjectMenu>
                          )}
                        </Match>
                        <Match
                          when={row.kind === 'load-more' ? row : undefined}
                        >
                          {(more) => (
                            <div role="row" id={more().id}>
                              <div
                                role="gridcell"
                                aria-colspan={taskGridColumnCount(true)}
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
          }
        >
          <ProjectsGantt
            collection={collection}
            onOpen={props.onOpen}
            createAssigneeName={props.createAssigneeName}
            onCreate={
              definition(SYSTEM_PROPERTY_IDS.DUE_DATE)?.valueType === 'DATE'
                ? (dates) => createOnTimeline(dates.end)
                : undefined
            }
            ref={(element) => {
              timeline = element;
            }}
            renderEntity={(entity, label) => (
              <ProjectMenu entity={entity()}>
                <Gantt.Row>
                  {label}
                  <Gantt.Bar
                    {...projectTimelineDates(entity())}
                    title={entity().project.name}
                    onEndChange={
                      canEditDueDate(entity())
                        ? (date) => saveDueDate(entity().id, date)
                        : undefined
                    }
                    onClick={(event) =>
                      props.onOpen(entity().id, {
                        event,
                        newSplit:
                          event.shiftKey ||
                          event.ctrlKey ||
                          event.metaKey ||
                          event.altKey,
                      })
                    }
                  >
                    {entity().project.name}
                  </Gantt.Bar>
                </Gantt.Row>
              </ProjectMenu>
            )}
          />
        </Show>
        <Show when={renaming()} keyed>
          {(row) => (
            <RenameProjectDialog
              name={row.project.name}
              onOpenChange={(open) => {
                if (!open) setRenaming(undefined);
              }}
              onRename={(name) => commands.rename(row.project.id, name)}
              onCloseAutoFocus={returnFocusToList}
            />
          )}
        </Show>
        <Show when={deleting()}>
          {(request) => (
            <DeleteProjectsDialog
              count={request().rows.length}
              pending={deletePending()}
              error={request().error}
              onOpenChange={(open) => {
                if (!open) setDeleting(undefined);
              }}
              onDelete={() => void deleteProjects(request().rows)}
              onCloseAutoFocus={returnFocusToList}
            />
          )}
        </Show>
      </ViewShell.Content>
    </>
  );
}
