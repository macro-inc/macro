import { Gantt } from '@app/components/gantt/gantt';
import type { GanttCreation } from '@app/components/gantt/gantt-create-area';
import { deriveGanttRange } from '@app/components/gantt/gantt-date';
import CaretRightIcon from '@phosphor/caret-right.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import { Button, cn } from '@ui';
import {
  type Accessor,
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
        <Match when={!collection.items().length && !props.onCreate}>
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
          <Gantt.Root range={range()}>
            <Gantt.Chart>
              <Gantt.Header>
                <Gantt.TodayButton />
                <Gantt.Settings />
              </Gantt.Header>
              <Gantt.Rows
                items={collection.items()}
                getKey={(row) => row.id}
                virtualize
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
                        return props.renderEntity(
                          () => item().entity,
                          <Gantt.Label>
                            <button
                              type="button"
                              class="flex size-full min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              title={item().entity.project.name}
                              onClick={(event) => open(item().entity.id, event)}
                            >
                              <PropertyValueIcon
                                optionId={statusId() ?? ''}
                                class="size-4 shrink-0"
                              />
                              <span class="min-w-0 flex-1">
                                <span class="block truncate">
                                  {item().entity.project.name}
                                </span>
                                <Gantt.DateHint
                                  {...projectTimelineDates(item().entity)}
                                />
                              </span>
                            </button>
                          </Gantt.Label>
                        );
                      }}
                    </Match>
                    <Match when={row.kind === 'group-header' ? row : undefined}>
                      {(group) => (
                        <Gantt.Row>
                          <Gantt.Label>
                            <button
                              type="button"
                              aria-expanded={collection.disclosure.isExpanded(
                                group().groupId
                              )}
                              class="flex size-full min-w-0 items-center gap-2 text-left font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent"
                              onClick={() =>
                                collection.disclosure.toggle(group().groupId)
                              }
                            >
                              <CaretRightIcon
                                class={cn(
                                  'size-3.5 shrink-0 transition-transform',
                                  collection.disclosure.isExpanded(
                                    group().groupId
                                  ) && 'rotate-90'
                                )}
                              />
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
                                <span class="ml-auto text-xs text-ink-muted">
                                  {group().count}
                                </span>
                              </Show>
                            </button>
                          </Gantt.Label>
                        </Gantt.Row>
                      )}
                    </Match>
                    <Match when={row.kind === 'load-more' ? row : undefined}>
                      {(more) => (
                        <Gantt.Row>
                          <Gantt.Label>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={more().isLoading}
                              onClick={() => void collection.loadMore()}
                            >
                              {more().isLoading
                                ? 'Loading…'
                                : 'Load more projects'}
                            </Button>
                          </Gantt.Label>
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
          </Gantt.Root>
        </Match>
      </Switch>
    </div>
  );
}
