import { useListInteractions } from '@app/components/list';
import {
  resolveEntityActionViewContext,
  toEntityActionListState,
  useEntityActionHotkeys,
} from '@app/features/next-soup/actions';
import {
  MaybeSoupEntityActionDrawerManager,
  SoupEntityContextMenu,
} from '@app/features/soup';
import { DEBUG_SETTING_KEYS, useDebugSetting } from '@app/lib/debugSettings';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { toast } from '@core/component/Toast/Toast';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import EmptyStateFolderGraphic from '@design/empty-state-folder.svg';
import {
  type EntityData,
  EntitySelectionToolbar,
  ListEntity,
  ListLayoutProvider,
} from '@entity';
import ArrowLeftIcon from '@phosphor/arrow-left.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, EmptyStatePanel } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
  Switch,
} from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import { useDriveView } from '../context/drive-context';

export function DriveList() {
  const { state, source, list: listState, actions } = useDriveView();

  const panel = useSplitPanelOrThrow();

  const { isKeypressActive } = useIsKeyPressActive();

  const list = listState.controller;

  const hasFilters = () => {
    if (state.value().scope !== 'default') return true;

    return Object.values(state.value().facets).some((ids) => ids.length > 0);
  };

  const isSearching = () => state.value().search.trim().length > 0;

  const rowElementId = (key: string | undefined) => {
    if (!key) return undefined;

    return `drive-${panel.handle.id}-${key}`;
  };

  const timestamp = (entity: EntityData) => {
    const { location, sort } = state.value();

    if (location.kind === 'tab' && location.tab === 'recent')
      return entity.touchedAt;
    if (entity.sortTs) return entity.sortTs;
    if (sort === 'viewed_at') return entity.viewedAt;
    if (sort === 'created_at') return entity.createdAt;

    return entity.updatedAt;
  };

  const [grid, setGrid] = createSignal<HTMLDivElement>();

  const [viewport, setViewport] = createSignal<HTMLDivElement>();

  const [virtualizer, setVirtualizer] = createSignal<VirtualizerHandle>();

  const forceEmptyState = useDebugSetting(
    DEBUG_SETTING_KEYS.FORCE_EMPTY_STATES
  );

  const selected = createMemo(() =>
    list.selection.items().map((row) => row.entity)
  );

  const actionContext = () =>
    resolveEntityActionViewContext({
      activeListView: 'documents',
      activeTab: 'all',
    });

  const actionState = toEntityActionListState({
    controller: list,

    getEntity: (row) => row.entity,

    onFocus: (target) => {
      if (target)
        virtualizer()?.scrollToIndex(target.index, { align: 'nearest' });

      grid()?.focus();
    },
  });

  async function loadMore() {
    try {
      await source.loadMore();
    } catch {
      // The source retains the error for the inline retry UI.
    }
  }

  function checkNearEnd() {
    if (forceEmptyState() || source.error()) return;
    if (source.isLoading() || source.isFetching() || !source.hasMore()) return;

    const container = viewport();

    if (!container || container.clientHeight === 0) return;

    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    if (distance < 300) void loadMore();
  }

  const viewportSize = createElementSize(viewport);

  createEffect(() => {
    source.items();
    source.isFetching();
    viewportSize.height;

    // A filtered page may be too short to produce a scroll event.
    const frame = requestAnimationFrame(checkNearEnd);

    onCleanup(() => cancelAnimationFrame(frame));
  });

  async function refresh() {
    try {
      await source.refresh();
    } catch {
      toast.failure('Files couldn’t be loaded. Try again.');
    }
  }

  const interactions = useListInteractions({
    controller: list,
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    scrollHandle: virtualizer,
    navigation: {
      onNavigate: (event) => {
        if (event.kind !== 'move' || event.direction !== 1) return;
        if (source.error()) return;

        if (!event.result || list.items.count() - event.result.index <= 4) {
          void loadMore();
        }
      },
    },

    activation: {
      createMetadata: (intent) => ({ newSplit: intent === 'alternate' }),

      alternateDescription: 'Open in new split',
    },
  });

  useEntityActionHotkeys({
    scopeId: panel.splitHotkeyScope,
    list: actionState,
    selectedEntities: selected,

    focusedEntity: () => list.focus.item()?.entity,

    restoreFocus: () => grid()?.focus(),

    viewContext: actionContext,
    splitHandle: panel.handle,
    condition: panel.isPanelActive,
  });

  onMount(() => {
    if (!panel.isPanelActive() || isTouchDevice()) return;

    const active = document.activeElement;

    if (
      active instanceof HTMLElement &&
      (active.isContentEditable || active.matches('input, textarea'))
    )
      return;

    grid()?.focus({ preventScroll: true });
  });

  // Reconcile the imperative keyboard focus anchor after results change.
  createEffect(() => {
    source.items();

    if (source.isLoading() || list.focus.result()) return;

    if (
      list.focus.restore(list.focus.requestedKey(), {
        retainUnavailable: false,
      })
    )
      return;

    if (isTouchDevice() || panel.handle.isControllerSplit()) return;

    list.focus.first({ reason: 'restore' });
  });

  createEffect(
    on(listState.scrollOffset, (offset) => {
      const handle = virtualizer();

      if (handle && handle.scrollOffset !== offset) handle.scrollTo(offset);
    })
  );

  const featuredCount = createMemo(() => {
    const ids = new Set(source.featuredIds());

    return source.items().filter((row) => ids.has(row.entity.id)).length;
  });

  const showError = () => !!source.error() && !source.hasData();

  const folderIsEmpty = () => {
    if (!state.projectId() || isSearching()) return false;
    if (hasFilters() || source.hasMore()) return false;

    return true;
  };

  const emptyMessage = () => {
    if (source.error()) return 'More files couldn’t be loaded.';
    if (source.hasMore()) return 'Looking for matching files…';
    if (isSearching()) return 'No files match this search.';

    return 'No files in this view.';
  };

  return (
    <MaybeSoupEntityActionDrawerManager>
      <StaticMarkdownContext>
        <div
          ref={setGrid}
          role="grid"
          aria-label="Drive files"
          aria-multiselectable="true"
          aria-activedescendant={rowElementId(list.focus.key())}
          tabIndex={0}
          class="@container/u-list relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden outline-none"
        >
          <ListLayoutProvider ref={grid}>
            <Switch>
              <Match when={!forceEmptyState() && showError()}>
                <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted">
                  <span>Files couldn’t be loaded.</span>
                  <Button variant="outline" onClick={() => void refresh()}>
                    Try again
                  </Button>
                </div>
              </Match>
              <Match
                when={
                  !forceEmptyState() &&
                  source.isLoading() &&
                  source.items().length === 0
                }
              >
                <div
                  role="status"
                  class="grid min-h-0 flex-1 place-items-center text-ink-muted"
                >
                  <SpinnerIcon
                    aria-label="Loading files"
                    class="size-5 animate-spin"
                  />
                </div>
              </Match>
              <Match when={forceEmptyState() || source.items().length === 0}>
                <Show
                  when={folderIsEmpty()}
                  fallback={
                    <div
                      ref={setViewport}
                      class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-ink-muted"
                    >
                      <span>{emptyMessage()}</span>
                      <Show when={hasFilters()}>
                        <Button variant="outline" onClick={state.clearFilters}>
                          Clear filters
                        </Button>
                      </Show>
                      <Show when={!forceEmptyState() && source.hasMore()}>
                        <Button
                          variant="outline"
                          disabled={source.isFetching()}
                          onClick={() => void loadMore()}
                        >
                          Search more results
                        </Button>
                      </Show>
                    </div>
                  }
                >
                  <EmptyStatePanel
                    centered
                    graphic={EmptyStateFolderGraphic}
                    title="This folder is empty"
                    description="Create something new or drop files here to add them to this folder."
                    primaryAction={{
                      label: 'Back to Drive',
                      icon: ArrowLeftIcon,
                      onClick: () => state.selectFolder(null),
                    }}
                  />
                </Show>
              </Match>
              <Match when={true}>
                <div
                  ref={setViewport}
                  class="min-h-0 flex-1 overflow-auto overscroll-none"
                >
                  <Suspense>
                    <Virtualizer
                      ref={(handle) => {
                        setVirtualizer(handle);
                        handle?.scrollTo(listState.scrollOffset());
                      }}
                      data={source.items()}
                      scrollRef={viewport()}
                      bufferSize={240}
                      itemSize={44}
                      keepMounted={
                        list.focus.index() >= 0
                          ? [list.focus.index()]
                          : undefined
                      }
                      onScroll={(offset) => {
                        listState.setScrollOffset(offset);
                        checkNearEnd();
                      }}
                    >
                      {(row, index) => (
                        <div>
                          <Show
                            when={
                              featuredCount() > 0 &&
                              (index() === 0 || index() === featuredCount())
                            }
                          >
                            <div class="px-3 py-2 text-xs font-semibold text-ink-muted">
                              {index() === 0
                                ? 'Featured Results'
                                : 'More Results'}
                            </div>
                          </Show>
                          <div
                            id={rowElementId(row.id)}
                            role="row"
                            aria-selected={list.selection.isSelected(row.id)}
                          >
                            <div role="gridcell">
                              <SoupEntityContextMenu
                                entity={row.entity}
                                list={actionState}
                                selectedEntities={selected}
                                viewContext={actionContext()}
                                onOpenChange={(open) => {
                                  if (!open) return;

                                  list.focus.set(row.id, {
                                    reason: 'pointer',
                                    force: true,
                                  });

                                  list.selection.setAnchor(row.id);
                                }}
                              >
                                <ListEntity
                                  entity={row.entity}
                                  showCalendarAttendance
                                  deferInteractions={source.deferInteractions()}
                                  timestamp={timestamp(row.entity)}
                                  highlighted={list.focus.key() === row.id}
                                  checked={list.selection.isSelected(row.id)}
                                  onMouseMove={() => {
                                    if (isKeypressActive()) return;
                                    if (panel.handle.isControllerSplit())
                                      return;

                                    list.focus.set(row.id, { reason: 'hover' });
                                  }}
                                  onFilterByTag={(id) => state.setTags([id])}
                                  onChecked={(checked, shiftKey) =>
                                    interactions.selection.set(
                                      row.id,
                                      checked,
                                      { range: shiftKey }
                                    )
                                  }
                                  onClick={(event) => {
                                    if (
                                      event.metaKey ||
                                      event.ctrlKey ||
                                      (isTouchDevice() &&
                                        list.selection.count() > 0)
                                    ) {
                                      interactions.selection.toggle(row.id);

                                      return;
                                    }

                                    list.activate.key(row.id, {
                                      reason: 'pointer',
                                      metadata: { event },
                                    });
                                  }}
                                  onProjectClick={(project, event) =>
                                    actions.openEntity(project, event)
                                  }
                                  onContentHitClick={(event, location) =>
                                    actions.openEntity(
                                      row.entity,
                                      event,
                                      location
                                    )
                                  }
                                />
                              </SoupEntityContextMenu>
                            </div>
                          </div>
                          <Show when={index() === source.items().length - 1}>
                            <Show when={source.isLoadingMore()}>
                              <div
                                role="status"
                                class="flex items-center gap-2 p-3 text-xs text-ink-muted"
                              >
                                <SpinnerIcon class="size-3 animate-spin" />
                                Loading more…
                              </div>
                            </Show>
                            <Show when={source.error()}>
                              <div
                                role="alert"
                                class="flex items-center gap-2 p-3 text-xs text-ink-muted"
                              >
                                More files couldn’t be loaded.
                                <Button
                                  variant="outline"
                                  onClick={() => void loadMore()}
                                >
                                  Try again
                                </Button>
                              </div>
                            </Show>
                            <div class="h-15" />
                          </Show>
                        </div>
                      )}
                    </Virtualizer>
                  </Suspense>
                </div>
              </Match>
            </Switch>
            <Show
              when={
                isSearching() && source.isFetching() && !source.isLoadingMore()
              }
            >
              <div
                role="status"
                class="pointer-events-none absolute bottom-3 right-3 text-xs text-ink-muted"
              >
                Searching…
              </div>
            </Show>
            <Show when={selected().length > 0}>
              <EntitySelectionToolbar
                selected={selected()}
                onClear={interactions.selection.clear}
                analyticsSource="drive_view_selection_toolbar"
              />
            </Show>
          </ListLayoutProvider>
        </div>
      </StaticMarkdownContext>
    </MaybeSoupEntityActionDrawerManager>
  );
}
