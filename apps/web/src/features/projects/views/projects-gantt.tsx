import { Gantt } from '@app/components/gantt/gantt';
import type { GanttCreation } from '@app/components/gantt/gantt-create-area';
import { deriveGanttRange } from '@app/components/gantt/gantt-date';
import { STATUS_GROUP_HEADER_TINTS } from '@app/features/tasks-view/components/task-list/TaskGroupHeader';
import { UserIcon } from '@core/component/UserIcon';
import CaretRightIcon from '@phosphor/caret-right.svg';
import CircleDashedIcon from '@phosphor/circle-dashed.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { Button, cn, Layer } from '@ui';
import {
  type Accessor,
  type ComponentProps,
  createMemo,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import type {
  createProjectCollection,
  ProjectListActivation,
  ProjectListEntity,
  ProjectListItem,
} from '../primitives/project-collection';
import { projectTimelineDates } from '../queries/project-timeline';

function AssigneeLabel(props: {
  id: string;
  createName: (id: Accessor<string>) => Accessor<string>;
}) {
  const name = props.createName(() => props.id);
  return <>{name()}</>;
}

export function ProjectsGantt(props: {
  createAssigneeName: (id: Accessor<string>) => Accessor<string>;
  collection: ReturnType<typeof createProjectCollection>;
  items: Accessor<readonly ProjectListItem[]>;
  groupMoves: Omit<ComponentProps<typeof Gantt.GroupDrag>, 'children'>;
  onOpen: (id: string, metadata?: ProjectListActivation) => void;
  onCreate?: (dates: GanttCreation) => void;
  /** Compose the complete project row so host-owned menus cover its label and bar. */
  renderEntity: (
    entity: Accessor<ProjectListEntity>,
    label: JSX.Element
  ) => JSX.Element;
  ref?: (element: HTMLDivElement) => void;
}) {
  const collection = props.collection;
  const range = createMemo(() => {
    const state = collection.state();
    return deriveGanttRange(
      state.kind === 'ready' ? state.rows.map(projectTimelineDates) : []
    );
  });
  const sourceError = () => {
    const state = collection.state();
    return state.kind === 'error' ? state.error : undefined;
  };
  const backgroundError = () => {
    const state = collection.state();
    return state.kind === 'ready' ? state.backgroundError : undefined;
  };
  const open = (id: string, event: MouseEvent) =>
    props.onOpen(id, {
      event,
      newSplit:
        event.shiftKey || event.metaKey || event.ctrlKey || event.altKey,
    });

  return (
    <div ref={props.ref} class="flex size-full min-h-0 min-w-0 flex-1 flex-col">
      <Switch>
        <Match when={collection.state().kind === 'loading'}>
          <div class="grid flex-1 place-items-center text-ink-muted">
            <SpinnerIcon
              aria-label="Loading project timeline"
              class="size-5 animate-spin"
            />
          </div>
        </Match>
        <Match when={sourceError()}>
          <div
            role="alert"
            class="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted"
          >
            Projects couldn’t be loaded.
            <Button variant="outline" onClick={() => void collection.refresh()}>
              Try again
            </Button>
          </div>
        </Match>
        <Match when={!props.items().length && !props.onCreate}>
          <div class="grid flex-1 place-items-center text-sm text-ink-muted">
            No matching projects
          </div>
        </Match>
        <Match when={true}>
          <Show when={backgroundError()}>
            <p role="status" class="px-3 py-2 text-xs text-ink-muted">
              Could not refresh projects. Showing the last loaded timeline.
            </p>
          </Show>
          <Gantt.Root range={range()} labelWidth={0}>
            <Gantt.SidebarToggle />
            <Gantt.Controls>
              <Gantt.TodayButton />
              <Gantt.Settings />
            </Gantt.Controls>
            <Gantt.GroupDrag {...props.groupMoves}>
              <Gantt.Chart>
                <Gantt.Header />
                <Gantt.Rows
                  items={props.items()}
                  getKey={(row) => row.id}
                  getPanelKey={(row) =>
                    row.kind === 'entity' || row.kind === 'load-more'
                      ? (row.groupId ?? '')
                      : undefined
                  }
                  virtualize
                  renderDropPreview={(move) => {
                    const state = collection.state();
                    const entity =
                      state.kind === 'ready'
                        ? state.rows.find((row) => row.project.id === move.id)
                        : undefined;
                    return (
                      entity && (
                        <Gantt.DropPreview
                          {...projectTimelineDates(entity)}
                          title={entity.project.name}
                        />
                      )
                    );
                  }}
                >
                  {(row) => (
                    <Switch>
                      <Match when={row.kind === 'entity' ? row : undefined}>
                        {(item) => {
                          const status = () =>
                            item().entity.properties.find(
                              (property) =>
                                property.propertyDefinitionId ===
                                SYSTEM_PROPERTY_IDS.STATUS
                            );
                          const statusId = () => {
                            const property = status();
                            return property?.valueType === 'SELECT_STRING'
                              ? property.value?.[0]
                              : undefined;
                          };
                          return (
                            <Gantt.DragItem
                              id={item().entity.id}
                              key={item().id}
                              groupId={item().groupId ?? ''}
                              label={item().entity.project.name}
                            >
                              {props.renderEntity(
                                () => item().entity,
                                <>
                                  <Gantt.GroupDrop
                                    id={item().id}
                                    groupId={item().groupId ?? ''}
                                  />
                                  <Gantt.Label>
                                    <Layer depth={2}>
                                      <button
                                        type="button"
                                        class="flex h-7 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md px-2 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                                        title={item().entity.project.name}
                                        onClick={(event) =>
                                          open(item().entity.id, event)
                                        }
                                      >
                                        <PropertyValueIcon
                                          optionId={statusId() ?? ''}
                                          class="size-3.5 shrink-0"
                                        />
                                        <span class="min-w-0 flex-1 leading-3.5">
                                          <span class="block truncate">
                                            {item().entity.project.name}
                                          </span>
                                          <Gantt.DateHint
                                            {...projectTimelineDates(
                                              item().entity
                                            )}
                                            class="leading-3"
                                          />
                                        </span>
                                      </button>
                                    </Layer>
                                  </Gantt.Label>
                                </>
                              )}
                            </Gantt.DragItem>
                          );
                        }}
                      </Match>
                      <Match
                        when={row.kind === 'group-header' ? row : undefined}
                      >
                        {(group) => (
                          <Gantt.Row>
                            <Gantt.GroupDrop
                              id={group().id}
                              groupId={group().groupId}
                            />
                            <Gantt.GroupHeader
                              class={
                                collection.groupBy() === 'status'
                                  ? STATUS_GROUP_HEADER_TINTS[group().groupId]
                                  : undefined
                              }
                            >
                              <button
                                type="button"
                                aria-expanded={collection.disclosure.isExpanded(
                                  group().groupId
                                )}
                                class="flex h-full w-full min-w-0 items-center gap-2.5 rounded-[inherit] px-2 py-1.5 text-left text-xs font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                                onClick={() =>
                                  collection.disclosure.toggle(group().groupId)
                                }
                              >
                                <Layer depth={3}>
                                  <span class="flex size-4.5 shrink-0 items-center justify-center rounded-xs group-hover/header:bg-ink/5">
                                    <CaretRightIcon
                                      class={cn(
                                        'size-2.5 transition-transform',
                                        collection.disclosure.isExpanded(
                                          group().groupId
                                        ) && 'rotate-90'
                                      )}
                                    />
                                  </span>
                                </Layer>
                                <Switch>
                                  <Match when={!group().groupId}>
                                    <CircleDashedIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
                                  </Match>
                                  <Match
                                    when={
                                      collection.groupBy() === 'status' ||
                                      collection.groupBy() === 'priority'
                                    }
                                  >
                                    <PropertyValueIcon
                                      optionId={group().groupId}
                                      class="size-3.5 shrink-0"
                                    />
                                  </Match>
                                  <Match
                                    when={collection.groupBy() === 'assignee'}
                                  >
                                    <UserIcon
                                      id={group().groupId}
                                      size="sm"
                                      suppressClick
                                      showTooltip={false}
                                    />
                                  </Match>
                                </Switch>
                                <span class="truncate">
                                  <Show
                                    when={
                                      collection.groupBy() === 'assignee' &&
                                      group().groupId
                                    }
                                    fallback={group().label}
                                  >
                                    <AssigneeLabel
                                      id={group().groupId}
                                      createName={props.createAssigneeName}
                                    />
                                  </Show>
                                </span>
                                <Show when={group().count !== undefined}>
                                  <span class="shrink-0 rounded-full bg-ink/10 px-1.5 py-px text-xs font-medium tabular-nums text-ink-extra-muted">
                                    {group().count}
                                  </span>
                                </Show>
                              </button>
                            </Gantt.GroupHeader>
                          </Gantt.Row>
                        )}
                      </Match>
                      <Match when={row.kind === 'load-more' ? row : undefined}>
                        {(more) => (
                          <Gantt.Row>
                            <div class="absolute inset-0">
                              <Gantt.Label>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={more().isLoading}
                                  onClick={() => void collection.loadMore()}
                                >
                                  <Show when={more().isLoading}>
                                    <SpinnerIcon class="size-3 animate-spin" />
                                  </Show>
                                  {more().isLoading
                                    ? 'Loading projects…'
                                    : 'Load more projects'}
                                </Button>
                              </Gantt.Label>
                            </div>
                            <Gantt.Pagination>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={more().isLoading}
                                onClick={() => void collection.loadMore()}
                              >
                                <Show when={more().isLoading}>
                                  <SpinnerIcon class="size-3 animate-spin" />
                                </Show>
                                {more().isLoading
                                  ? 'Loading projects…'
                                  : 'Load more projects'}
                              </Button>
                            </Gantt.Pagination>
                          </Gantt.Row>
                        )}
                      </Match>
                      <Match
                        when={row.kind === 'section-header' ? row : undefined}
                      >
                        {(section) => (
                          <Gantt.Row>
                            <Gantt.Label>{section().label}</Gantt.Label>
                          </Gantt.Row>
                        )}
                      </Match>
                    </Switch>
                  )}
                </Gantt.Rows>
                <Gantt.TodayMarker />
                <Gantt.CreateArea
                  minDate={new Date()}
                  onCreate={props.onCreate}
                />
              </Gantt.Chart>
            </Gantt.GroupDrag>
            <Gantt.ZoomControls />
          </Gantt.Root>
        </Match>
      </Switch>
    </div>
  );
}
