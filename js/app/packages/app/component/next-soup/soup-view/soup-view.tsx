import CheckIcon from '@icon/bold/check-bold.svg';
import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import {
  useGlobalBlockOrchestrator,
  useGlobalNotificationSource,
} from '@app/component/GlobalAppState';
import { EntityRow, EntityRowProvider } from '@app/component/mobile/EntityRow';
import {
  makeMarkDoneAction,
  useEntityActionHotkeys,
} from '@app/component/next-soup/actions';
import { useSoup } from '@app/component/next-soup/soup-context';
import { SoupEntityContextMenu } from '@app/component/next-soup/soup-view/soup-entity-context-menu';
import {
  type SoupEntity,
  type SoupRow,
  SoupViewContextProvider,
  useSoupView,
} from '@app/component/next-soup/soup-view/soup-view-context';
import { useSoupNavigationHotkeys } from './use-soup-navigation-hotkeys';
import { useSoupViewHotkeys } from './use-soup-view-hotkeys';
import { useElementItemCount } from '@app/component/next-soup/use-element-item-count';
import { registerPreviewEntity } from '@app/signal/splitLayout';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { fileTypeToResolvedBlockName } from '@core/constant/allBlocks';
import {
  openEntityInNewTab,
  openEntityInSplitFromUnifiedList,
} from '@app/component/next-soup/utils';
import {
  PreviewPanel,
  useMaybePreviewPanel,
} from '@app/component/PreviewPanel';
import { SplitPanelContext } from '@app/component/split-layout/context';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { useTaskProperties } from '@core/component/Properties/hooks';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import {
  type EntityData,
  isTaskEntity,
  type Notification,
  queryKeys,
  unreadFilterFn,
  useQueryClient,
} from '@macro-entity';
import {
  createEffectOnEntityTypeNotification,
  getMetadata,
  isChannelMention,
  isChannelMessageReply,
  isChannelMessageSend,
  tryToTypedNotification,
  type UnifiedNotification,
} from '@notifications';
import { debounce } from '@solid-primitives/scheduled';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { type VirtualizerHandle, VList } from 'virtua/solid';
import { SoupEntitySelectionToolbar } from './soup-entity-selection-toolbar';
import { SoupToolbar } from './soup-toolbar';
import { useUserId } from '@core/context/user';
import {
  type EntityClickHandler,
  type EntityPointerDownHandler,
  EntityWithEverything,
} from '../../../../macro-entity/src/components/EntityWithEverything';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { SoupViewFileDropzone } from '@app/component/next-soup/soup-view/soup-view-file-dropzone';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { invalidateEntityNotifications } from '@queries/notification/user-notifications';
import { soupKeys } from '@queries/soup/keys';
import type { CacheSnapshot } from 'virtua/unstable_core';
import { EmptyState } from '@app/component/next-soup/soup-view/empty-states';
import { SoupChatInput } from '@app/component/SoupChatInput';
import { ENABLE_UNIFIED_LIST_AI_INPUT } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import type { SystemSortOption } from '@app/component/next-soup/soup-view/sort-options';

const DEFAULT_ENTITY_HEIGHT = 40;

const useSoupNotificationInvalidators = () => {
  const notificationSource = useGlobalNotificationSource();
  const entityQueryClient = useQueryClient();

  createEffectOnEntityTypeNotification(
    notificationSource,
    'channel',
    (notification) => {
      entityQueryClient.invalidateQueries({
        queryKey: soupKeys._def,
      });
      invalidateEntityNotifications(notification.entity_id);
    }
  );

  createEffectOnEntityTypeNotification(notificationSource, 'email', () => {
    entityQueryClient.invalidateQueries({
      // HACK: this needs to be improved, since we use a single query, per entity invalidations
      // become a little more complicated.
      queryKey: queryKeys.all.entity,
    });
  });

  createEffectOnEntityTypeNotification(
    notificationSource,
    'document',
    (notification) => {
      if (notification.notificationEventType === 'task_assigned') {
        entityQueryClient.invalidateQueries({
          queryKey: soupKeys._def,
        });
        invalidateEntityNotifications(notification.entity_id);
      }
    }
  );
};

const stateCache = new Map<
  string,
  {
    soup: {
      focus: string | undefined;
      filters: string[];
      sort: SystemSortOption[];
    };
    virtualCache: CacheSnapshot;
    scrollOffset: number;
  }
>();

export const SoupView = () => {
  const soup = useSoup();
  const panel = useSplitPanelOrThrow();

  useSoupNotificationInvalidators();

  return (
    <SplitPanelContext.Provider
      value={{
        ...panel,
        halfSplitState: () =>
          soup.previewEntity() ? { side: 'left', percentage: 30 } : undefined,
      }}
    >
      <SoupViewContextProvider soup={soup}>
        <div class="relative flex-grow min-h-0 flex max-sm:flex-col flex-row size-full">
          <SoupToolbar />
          <SoupViewFileDropzone>
            <SoupViewList />
          </SoupViewFileDropzone>
        </div>
        <Show when={ENABLE_UNIFIED_LIST_AI_INPUT && !isMobile()}>
          <SoupChatInput />
        </Show>
      </SoupViewContextProvider>
    </SplitPanelContext.Provider>
  );
};

interface SoupViewListProps {
  customScrollbarHidden?: boolean;
}

export const SoupViewList = (props: SoupViewListProps) => {
  const panel = useSplitPanelOrThrow();
  const { soup, source, rows: _rows, searchText } = useSoupView();
  const { getSplitCount } = useSplitLayout();

  const rows = createMemo(() => _rows());

  const { isKeypressActive } = useIsKeyPressActive();

  const [virtualizerHandle, setVirtualizerHandle] =
    createSignal<VirtualizerHandle>();

  const [soupViewRef, setSoupViewRef] = createSignal<HTMLElement | undefined>();

  const [previewPanelRef, setPreviewPanelRef] = createSignal<
    HTMLElement | undefined
  >();

  const focusFirstEntity = () => {
    const next = soup.navigate.toFirst();

    if (next) {
      virtualizerHandle()?.scrollToIndex(next.index, { align: 'nearest' });
    }
  };

  let initialLoad = true;

  const registerFocusEffects = (moveInitialFocus = true) => {
    if (moveInitialFocus) {
      createEffect(
        on(rows, () => {
          if (!initialLoad || source.isLoading()) return;
          focusFirstEntity();
          initialLoad = false;
        })
      );
    }

    createEffect(
      on(
        () => [soup.filters.activeIds(), searchText()] as const,
        () => {
          focusFirstEntity();
        },
        { defer: true }
      )
    );
  };

  const previewPanel = useMaybePreviewPanel();

  // Auto focus the soup on mount except when it's in a preview panel
  createEffect(() => {
    if (previewPanel) return;

    soupViewRef()?.focus();
  });

  const [attachHotkeys, soupViewScope] = useHotkeyDOMScope('soup-view');

  const scopeId = createMemo(() => {
    return previewPanel ? soupViewScope : panel.splitHotkeyScope;
  });

  // Register navigation hotkeys
  useSoupNavigationHotkeys({
    scopeId: scopeId(),
    soup,
    virtualizerHandle,
    previewPanelRef,
  });

  // Register entity action hotkeys
  useEntityActionHotkeys({
    scopeId: scopeId(),
    soup,
  });

  // Register soup view hotkeys (jump navigation, enter, escape, cmd+k, etc.)
  useSoupViewHotkeys({
    splitId: panel.handle.id,
    scopeId: scopeId(),
    soup,
    splitHandle: panel.handle,
    virtualizerHandle,
    previewState: () => !!soup.previewEntity(),
    getSplitCount,
  });

  // Register previewed entity for auto-attach
  createEffect(() => {
    const entity = soup.previewEntity() ? soup.focus.item() : undefined;
    if (!entity) {
      registerPreviewEntity(panel.handle.id, undefined);
      return;
    }
    const type =
      entity.type === 'document'
        ? fileTypeToResolvedBlockName(
            (entity as { fileType?: string }).fileType
          )
        : entity.type;
    registerPreviewEntity(panel.handle.id, { type, id: entity.id });
  });
  onCleanup(() => {
    registerPreviewEntity(panel.handle.id, undefined);
  });

  // Create markDone action for swipe/click handlers
  const userId = useUserId();
  const notificationSource = useGlobalNotificationSource();

  const markDoneAction = makeMarkDoneAction({
    userId,
    notificationSource: () => notificationSource,
  });

  const debouncedFetchMore = debounce(() => {
    if (source.isFetchingNextPage() || !source.hasNextPage()) return;

    source.fetchNextPage();
  });

  const orchestrator = useGlobalBlockOrchestrator();

  const taskPropertiesStore = useTaskProperties(soup.data);

  const onEntityClick: EntityClickHandler<EntityData> = async (args) => {
    const { type, event, location } = args;

    const entity = (
      type === 'entity' ? args.entity : args.projectEntity
    ) as EntityData;

    if (event.metaKey || event.ctrlKey) {
      openEntityInNewTab({ entity, location });
      return;
    }

    if (soup.previewEntity() && type === 'entity') {
      soup.focus.set(entity.id);
      return;
    }

    await openEntityInSplitFromUnifiedList(entity, {
      openInNewSplit: event.shiftKey,
      location,
      splitHandle: panel.handle,
    });
  };

  const onEntityDoubleClick: EntityClickHandler<EntityData> = async (args) => {
    const { entity, event, location } = args;

    if (!soup.previewEntity()) {
      return;
    }

    await openEntityInSplitFromUnifiedList(entity, {
      openInNewSplit: event.shiftKey,
      location,
      splitHandle: panel.handle,
    });
  };

  const onEntityPointerDown: EntityPointerDownHandler<EntityData> = async (
    args
  ) => {
    const { type, location, event } = args;

    const entity = (
      type === 'entity' ? args.entity : args.projectEntity
    ) as EntityData;

    // middle mouse button pressed
    if (event.button === 1 && event.pointerType === 'mouse') {
      // TODO: current page should remain focused after opening new tab
      openEntityInNewTab({ entity, location });
    }
  };

  const onClickEntityAction = (entity: EntityData) => {
    if (markDoneAction.canExecute(entity)) {
      markDoneAction.executeWithSoup([entity], soup);
    }
  };

  const blockOrchestrator = useGlobalBlockOrchestrator();
  const gotoChannelNotification = async (notification: UnifiedNotification) => {
    let message_id: string | undefined;
    let thread_id: string | undefined;

    if (isChannelMention(notification)) {
      const metadata = getMetadata(notification);
      message_id = metadata.messageId;
    } else if (isChannelMessageReply(notification)) {
      const metadata = getMetadata(notification);
      message_id = metadata.messageId;
      thread_id = metadata.threadId;
    } else if (isChannelMessageSend(notification)) {
      const metadata = getMetadata(notification);
      message_id = metadata.messageId;
    } else {
      return;
    }

    const blockHandle = await blockOrchestrator.getBlockHandle(
      notification.entity_id,
      'channel'
    );
    if (!blockHandle) return;

    notificationSource.markAsRead(notification);

    return blockHandle?.goToLocationFromParams({
      [CHANNEL_PARAMS.message]: message_id,
      [CHANNEL_PARAMS.thread]: thread_id,
    });
  };

  const onClickNotification = ({
    entity,
  }: {
    entity: SoupEntity & { notification: Notification };
  }) => {
    const notification = tryToTypedNotification(entity.notification);
    if (!notification || entity.type !== 'channel') return;

    gotoChannelNotification(notification);
  };

  let lastClickedEntityId = -1;

  const getSelectionAnchorIndex = (params: {
    entities: SoupRow[];
    lastClickedIndex: number;
  }) => {
    // Try to grab the last clicked item and fall back on the highest currently
    // selected index.
    let anchorIndex = params.lastClickedIndex;
    if (anchorIndex === -1) {
      for (let i = 0; i < params.entities.length; i++) {
        if (params.entities[i].isSelected()) {
          anchorIndex = i;
        }
      }
    }
    return anchorIndex;
  };

  const handleMultiSelectChecked = (params: {
    entity: EntityData;
    entityIndex: number;
    next: boolean;
    shiftKey: boolean;
  }) => {
    if (!params.shiftKey) {
      soup.selection.toggle(params.entity);
      lastClickedEntityId = params.entityIndex;
      return;
    }

    const entityList = rows();

    const anchorIndex = getSelectionAnchorIndex({
      entities: entityList,
      lastClickedIndex: lastClickedEntityId,
    });

    if (anchorIndex === -1) {
      soup.selection.toggle(params.entity);
      lastClickedEntityId = params.entityIndex;
      return;
    }

    const newEntitiesForSelection = [];
    const sign = Math.sign(params.entityIndex - anchorIndex);

    for (
      let i = anchorIndex;
      sign > 0 ? i <= params.entityIndex : i >= params.entityIndex;
      i += sign
    ) {
      const entity = entityList[i];
      if (!entity.isSelected()) {
        newEntitiesForSelection.push(entity.original);
      }
    }

    soup.selection.selectRange(newEntitiesForSelection);

    lastClickedEntityId = params.entityIndex;
  };

  // reset last clicked on reset multi-selection.
  createEffect(() => {
    if (soup.selection.count() === 0) {
      lastClickedEntityId = -1;
    }
  });

  const [listRef, setListRef] = createSignal<HTMLDivElement>();

  const viewportItemCount = useElementItemCount({
    element: listRef,
    itemHeight: DEFAULT_ENTITY_HEIGHT,
  });

  // Fetch more data if we filter out more items than the viewport can display
  // because it's possible that the match exists on the server
  createEffect(
    on([rows, viewportItemCount], ([rows, viewportItemCount]) => {
      if (rows.length >= viewportItemCount || source.isFetching()) return;
      debouncedFetchMore();
    })
  );

  onCleanup(() => debouncedFetchMore.clear());

  const [entityContextMenuOpen, setEntityContextMenuOpen] = createSignal<
    string | undefined
  >(undefined);

  const [localEntityListRef, setLocalEntityListRef] = createSignal<
    HTMLDivElement | undefined
  >();

  const entityById = createMemo(
    () => {
      const list = rows() ?? [];
      const map = new Map<string, SoupRow>();
      for (const entity of list) {
        map.set(entity.original.id, entity);
      }
      return map;
    },
    new Map<string, SoupRow>(),
    {
      equals(prev, next) {
        return prev.size === next.size;
      },
    }
  );

  const getCacheKey = () => {
    let key = `soup-view-${panel.handle.id}`;

    if (previewPanel) {
      key += '-preview';
    }

    return key;
  };

  onCleanup(() => {
    const virtualHandle = virtualizerHandle();

    if (!virtualHandle) return;

    stateCache.set(getCacheKey(), {
      soup: {
        focus: soup.focus.id(),
        filters: soup.filters.activeIds(),
        sort: soup.sort.active().map((s) => s.id),
      },
      virtualCache: virtualHandle.cache,
      scrollOffset: virtualHandle.scrollOffset,
    });
  });

  const registerVirtualizerHandler = (
    handle: VirtualizerHandle | undefined
  ) => {
    setVirtualizerHandle(handle);

    const cached = stateCache.get(getCacheKey());

    if (!cached) {
      registerFocusEffects();
      return;
    }

    soup.focus.set(cached.soup.focus);
    for (const id of cached.soup.filters) {
      soup.filters.toggle(id);
    }

    soup.sort.setAll(cached.soup.sort);

    handle?.scrollTo(cached.scrollOffset);
    registerFocusEffects(false);
  };

  return (
    <div
      class="size-full flex bracket-never"
      ref={(el) => {
        setSoupViewRef(el);
        attachHotkeys(el);
      }}
      tabIndex={-1}
      onFocusIn={(e) => {
        e.stopPropagation();
      }}
      data-hotkey-scope={soupViewScope}
      data-soup-view
      data-soup-view-id={panel.handle.id + (previewPanel ? '-preview' : '')}
    >
      <div
        ref={setListRef}
        class="@container/uList size-full unified-list-root flex flex-col"
        classList={{
          'border-r border-edge-muted': soup.previewEntity() !== undefined,
        }}
      >
        <StaticMarkdownContext>
          <Switch>
            <Match when={source.isLoading()}>
              <LoadingBlock />
            </Match>
            <Match when={!rows().length}>
              <EmptyState search={!!searchText()} />
            </Match>
            <Match when={!source.isLoading() && rows().length}>
              <EntityRowProvider
                container={localEntityListRef}
                canSwipeLeft={(entityId) => {
                  const entity = entityById().get(entityId);
                  if (!entity) return false;
                  return markDoneAction.canExecute(entity.original);
                }}
                onSwipeLeft={(entityId) => {
                  const entity = entityById().get(entityId);
                  if (!entity) return;
                  markDoneAction.executeWithSoup([entity.original], soup);
                }}
                setCollapseEntity={soup.collapseEntity.set}
              >
                <SoupList
                  cache={stateCache.get(getCacheKey())?.virtualCache}
                  ref={setLocalEntityListRef}
                  virtualizerClass="scrollbar-hidden"
                  class="overflow-hidden flex min-w-0"
                  virtualizerRef={registerVirtualizerHandler}
                  onScrollBottom={debouncedFetchMore}
                  rows={rows()}
                >
                  {(row, i) => {
                    const timestamp = () => {
                      const sort_ = soup.sort.active();
                      if (!sort_.length) return;

                      switch (sort_[0].id) {
                        case 'viewed_at':
                          return row.original.viewedAt;
                        case 'created_at':
                          return row.original.createdAt;
                        case 'updated_at':
                          return row.original.updatedAt;
                      }
                    };

                    const properties = () => {
                      if (isTaskEntity(row.original)) {
                        return taskPropertiesStore()[row.original.id] ?? [];
                      }
                      return undefined;
                    };

                    const shouldDisplayDoneButton = () => {
                      if (row.original.type === 'email') {
                        return !row.original.done;
                      }

                      return (row.original.notifications?.().length ?? 0) > 0;
                    };

                    return (
                      <EntityRow
                        entityId={row.original.id}
                        swipeLeftColor="bg-success"
                        swipeLeftRevealedComponent={
                          <CheckIcon class="size-8 text-panel" />
                        }
                      >
                        <SoupEntityContextMenu
                          entity={row.original}
                          entityTimestamp={timestamp()}
                          onOpenChange={(open) => {
                            setEntityContextMenuOpen(
                              open ? row.original.id : undefined
                            );
                          }}
                        >
                          <div
                            class="flex flex-col w-full min-w-0"
                            style={{
                              'padding-left': `${row.depth * 8}px`,
                            }}
                          >
                            <Show
                              when={!row.isGrouped()}
                              fallback={
                                <div class="bg-accent flex gap-2 items-center px-2 py-1 text-input font-medium">
                                  <button
                                    type="button"
                                    onClick={() => row.toggleExpanded()}
                                  >
                                    {row.isExpanded() ? 'Close' : 'Open'}
                                  </button>
                                  <span>{row.original.name}</span>
                                </div>
                              }
                            >
                              <EntityWithEverything
                                splitId={panel.handle.id}
                                entity={row.original}
                                timestamp={timestamp()}
                                properties={properties()}
                                searchActive={!!searchText()}
                                selected={{
                                  active:
                                    row.isFocused() ||
                                    entityContextMenuOpen() === row.original.id,
                                  // TODO: Update this to take into account when this is used within a nested
                                  // view like the preview panel
                                  muted:
                                    row.isFocused() && !panel.isPanelActive(),
                                }}
                                highlighted={
                                  panel.isPanelActive() && row.isFocused()
                                }
                                onMouseOver={() => {
                                  if (
                                    soup.previewEntity() ||
                                    isKeypressActive()
                                  )
                                    return;
                                  soup.focus.set(row.original.id);
                                }}
                                onFocusIn={() => {
                                  if (soup.previewEntity()) return;
                                  soup.focus.set(row.original.id);
                                }}
                                showUnrollNotifications={
                                  soup.filters.isActive('signal') &&
                                  !soup.filters.isActive('noise')
                                }
                                unreadIndicatorActive={unreadFilterFn(
                                  row.original
                                )}
                                showDoneButton={shouldDisplayDoneButton()}
                                checked={row.isSelected()}
                                onChecked={(next, shiftKey) =>
                                  handleMultiSelectChecked({
                                    entity: row.original,
                                    entityIndex: i(),
                                    next,
                                    shiftKey: shiftKey ?? false,
                                  })
                                }
                                onClick={onEntityClick}
                                onDblClick={onEntityDoubleClick}
                                onPointerDown={onEntityPointerDown}
                                onClickRowAction={onClickEntityAction}
                                onClickNotification={onClickNotification}
                              />
                            </Show>
                          </div>
                        </SoupEntityContextMenu>
                      </EntityRow>
                    );
                  }}
                </SoupList>
              </EntityRowProvider>

              <Show when={!props.customScrollbarHidden}>
                <CustomScrollbar
                  scrollContainer={() => {
                    // Find the actual scroll container (VList creates its own scroll container)
                    const listEl = localEntityListRef();
                    if (!listEl) return undefined;
                    const scrollContainer = listEl.querySelector(
                      '[data-soup-list-container]'
                    ) as HTMLElement;
                    return scrollContainer || undefined;
                  }}
                />
              </Show>
            </Match>
          </Switch>
        </StaticMarkdownContext>
      </div>
      <Show when={soup.selection.count() > 0}>
        <SoupEntitySelectionToolbar
          selected={soup.selection.selected()}
          onClose={soup.selection.clear}
          onClear={soup.selection.clear}
        />
      </Show>
      <Show when={soup.previewEntity()}>
        <PreviewPanel
          ref={setPreviewPanelRef}
          selectedEntity={soup.focus.item()}
          orchestrator={orchestrator}
          splitPanelContext={panel}
          onFocusOut={() => {
            soupViewRef()?.focus();
          }}
        />
      </Show>
    </div>
  );
};

const DEFAULT_ITEM_SIZE = 10;
const DEFAULT_OVERSCAN = 5;

interface SoupListProps {
  ref?: (el: HTMLElement) => void;
  virtualizerRef?: (handle: VirtualizerHandle) => void;
  class?: string;
  virtualizerClass?: string;
  itemSize?: number;
  overscan?: number;
  children: (row: SoupRow, index: Accessor<number>) => JSX.Element;
  onScrollBottom?: VoidFunction;
  scrollBottomOffset?: number;
  rows: SoupRow[];
  cache?: CacheSnapshot;
}

const SoupList = (props: SoupListProps) => {
  const [virtualizerHandle, setVirtualizerHandle] =
    createSignal<VirtualizerHandle>();

  const itemSize = createMemo(() => props.itemSize ?? DEFAULT_ITEM_SIZE);
  const overscan = createMemo(() => props.overscan ?? DEFAULT_OVERSCAN);

  const handleScroll = (offset: number) => {
    const handle = virtualizerHandle();

    if (!handle) return;

    if (
      handle.scrollSize - handle.viewportSize - offset <=
      (props.scrollBottomOffset ?? 100)
    ) {
      props.onScrollBottom?.();
    }
  };

  const registerVirtualizerHandler = (
    handle: VirtualizerHandle | undefined
  ) => {
    setVirtualizerHandle(handle);

    if (handle) {
      props.virtualizerRef?.(handle);
    }
  };

  return (
    <div
      ref={props.ref}
      class={cn('unified-table-body size-full relative', props.class)}
    >
      <VList
        cache={props.cache}
        ref={registerVirtualizerHandler}
        class={props.virtualizerClass}
        data={props.rows}
        itemSize={itemSize()}
        bufferSize={overscan() * itemSize()}
        onScroll={handleScroll}
        data-soup-list-container
      >
        {(row, i) => props.children(row, i)}
      </VList>
    </div>
  );
};
