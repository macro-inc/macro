import { useAnalytics } from '@app/component/analytics-context';
import type { BlockName } from '@core/block';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant/fileType';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import { type EntityItem, useQuickAccess } from '@core/context/quickAccess';
import clickOutside from '@core/directive/clickOutside';
import { isMobile } from '@core/mobile/isMobile';
import type { ChannelWithParticipants, IUser } from '@core/user';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { debouncedDependent } from '@core/util/debounce';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import type { EmailEntity } from '@entity';
import type { HistoryItem as Item } from '@queries/history/history';
import { createLazyMemo } from '@solid-primitives/memo';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { Surface } from '@ui';
import { globalSplitManager } from 'app/signal/splitLayout';
import type { LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { floatWithElement } from '../../../directive/floatWithElement';
import { floatWithSelection } from '../../../directive/floatWithSelection';
import { CLOSE_INLINE_SEARCH_COMMAND } from '../../../plugins';
import type { MenuOperations } from '../../../shared/inlineMenu';
import type {
  DateMentionItem,
  MentionItem,
  UserMentionRecord,
} from '../../../utils/mentionsUtils';
import { useMenuKeyboardNavigation } from '../useMenuKeyboardNavigation';
import { ItemBin } from './components/ItemBin';
import { MentionsMenuItem } from './components/MentionsMenuItem';
import { useEmailSearchMention } from './hooks/useEmailSearchMention';
import {
  useEntityMention,
  useEntityMentionFromList,
} from './hooks/useEntityMention';
import { useUsersMention } from './hooks/useUsersMention';
import type { BucketConfig, MentionBucketId } from './MentionsMenuController';
import { useMentionsMenuController } from './MentionsMenuController';
import { createItemHandler } from './utils/mentionHandlers';
import { sortMobileMentions } from './utils/mobileSort';

const MAX_ITEMS = 8;
const VIRTUAL_ITEM_HEIGHT = 36;
// Height consumed by Surface's p-px border (2px) + py-2 padding (16px)
const PANEL_DECORATION_HEIGHT = 18;

export type MentionsMenuProps = {
  editor: LexicalEditor;
  menu: MenuOperations;
  /** pass in a custom users list if necessary */
  users?: Accessor<IUser[]>;
  /** pass in custom entity items to replace quickAccess data (e.g. sandbox data for onboarding) */
  entities?: Accessor<EntityItem[]>;
  /** whether the menu checks against block boundary in floating middleware. uses floating-ui default if false. */
  useBlockBoundary?: boolean;
  portalScope?: PortalScope;
  block?: BlockName;
  anchor?: HTMLElement | null;
  onUserMention?: (mention: UserMentionRecord) => void;
  onDocumentMention?: (item: Item | ChannelWithParticipants) => void;
  onEmailMention?: (item: EmailEntity) => void;
  disableMentionTracking?: boolean;
  /** whether to show open tabs as a bucket in the menu */
  showOpenTabs?: boolean;
  /** restrict which mention source buckets to show (e.g. ['users'] for user-only mentions) */
  sources?: MentionBucketId[];
};

export function MentionsMenu(props: MentionsMenuProps) {
  return (
    <Suspense>
      <MentionsMenuInner {...props} />
    </Suspense>
  );
}

function MentionsMenuInner(props: MentionsMenuProps) {
  const analytics = useAnalytics();

  const searchTerm = debouncedDependent(props.menu.searchTerm, 60);

  const hasCustomEntities = () => !!props.entities;

  const quickAccess = hasCustomEntities() ? undefined : useQuickAccess();

  const allItems = props.entities ?? quickAccess!.useList();

  const { isKeypressActive } = useIsKeyPressActive();

  const blockId = useMaybeBlockId();

  const { usersAndGroups, groups } = useUsersMention({
    users: props.users,
    searchTerm,
    isChannelBlock: props.block === 'channel',
    blockId: useMaybeBlockId(),
  });

  const customDocs = props.entities
    ? useEntityMentionFromList({
        items: props.entities,
        buckets: ['note', 'task', 'document', 'project', 'chat'],
        searchTerm,
      })
    : undefined;

  const customChannels = props.entities
    ? useEntityMentionFromList({
        items: props.entities,
        buckets: ['channel'],
        searchTerm,
      })
    : undefined;

  const { searchedEntities: docs } =
    customDocs ??
    useEntityMention({
      buckets: ['note', 'task', 'document', 'project', 'chat'],
      searchTerm,
    });

  const { searchedEntities: channels } =
    customChannels ??
    useEntityMention({
      buckets: ['channel'],
      searchTerm,
    });

  const { emails, emailSearchQuery: emailUnifiedSearchInfiniteQuery } =
    hasCustomEntities()
      ? {
          emails: () => [],
          emailSearchQuery: {
            hasNextPage: false,
            isFetching: false,
            fetchNextPage: () => {},
          } as any,
        }
      : useEmailSearchMention({
          searchTerm,
          enabled: () => !props.sources || props.sources.includes('emails'),
        });

  const dateOptions = useDateSearch({ query: searchTerm });
  const dates = createLazyMemo((): DateMentionItem[] => {
    return dateOptions().map(
      (option): DateMentionItem => ({
        kind: 'date',
        id: `date-${option.id}`,
        data: option,
      })
    );
  });

  const currentBlockId = useMaybeBlockId();

  const openTabs = createLazyMemo(() => {
    const splitManager = globalSplitManager();
    if (!splitManager) return [];

    const splits = splitManager.splits();
    const allItems_ = allItems();

    const tabItems: EntityItem[] = [];
    const seenKeys = new Set<string>();

    for (const split of splits) {
      if (
        split.content.type === 'component' ||
        (props.block === 'chat' &&
          !SUPPORTED_CHAT_ATTACHMENT_BLOCKS.includes(split.content.type))
      ) {
        continue;
      }

      if (split.content.id === currentBlockId) continue;

      const key = `${split.content.type}:${split.content.id}`;
      if (seenKeys.has(key)) continue;

      seenKeys.add(key);

      const item = allItems_.find((item) => item.id === split.content.id);
      if (!item || item.kind !== 'entity') continue;
      tabItems.push(item);
    }

    return tabItems;
  });

  const [menuOpen, setMenuOpen] = [props.menu.isOpen, props.menu.setIsOpen];

  const setSelectedIndexFromMouse = (index: number) => {
    if (isKeypressActive()) return;
    controller.selectItem(index);
  };

  const [mountSelection, setMountSelection] = createSignal<Selection | null>();

  const mobileAllItems = createLazyMemo((): MentionItem[] => {
    const combined: MentionItem[] = [
      ...(usersAndGroups() ?? []),
      ...(docs() ?? []),
      ...(channels() ?? []),
      ...(emails() ?? []),
      ...(dates() ?? []),
    ];
    return sortMobileMentions(combined, searchTerm());
  });

  const bucketConfigs = createLazyMemo((): BucketConfig[] => {
    if (isMobile()) {
      return [
        {
          id: 'all',
          label: 'All',
          getData: mobileAllItems,
          getFullCount: () => mobileAllItems().length,
        },
      ];
    }

    const buckets: BucketConfig[] = [
      {
        id: 'users',
        label: groups().length > 0 ? 'People & Groups' : 'People',
        getData: () => usersAndGroups() ?? [],
        getFullCount: () => usersAndGroups()?.length ?? 0,
      },
      {
        id: 'documents',
        label: 'Documents, Agents, & Tasks',
        getData: () => docs() ?? [],
        getFullCount: () => docs()?.length ?? 0,
      },
      {
        id: 'channels',
        label: 'Channels',
        getData: () => channels() ?? [],
        getFullCount: () => channels()?.length ?? 0,
      },
      {
        id: 'emails',
        label: 'Emails',
        getData: () => emails() ?? [],
        getFullCount: () => emails()?.length ?? 0,
      },
      {
        id: 'dates',
        label: 'Dates',
        getData: () => dates() ?? [],
        getFullCount: () => dates()?.length ?? 0,
      },
    ];

    if (props.showOpenTabs) {
      buckets.unshift({
        id: 'openTabs',
        label: 'Open Tabs',
        getData: () => openTabs() ?? [],
        getFullCount: () => openTabs()?.length ?? 0,
      });
    }

    const sourcesFilter = props.sources;
    const filtered = sourcesFilter
      ? buckets.filter((bucket) => sourcesFilter.includes(bucket.id as any))
      : buckets;

    return filtered.filter((bucket) => bucket.getFullCount() > 0);
  });

  const controller = useMentionsMenuController(bucketConfigs, {
    ignoredIds: () => (blockId ? [blockId] : []),
    maxItems: MAX_ITEMS,
  });

  const [escapeSpaceState, setEscapeSpaceState] = createSignal<
    'start' | 'single' | null
  >('start');

  createEffect(() => {
    if (!menuOpen()) {
      setEscapeSpaceState('start');
      controller.reset();
    }
  });

  const itemActionHandler = createItemHandler({
    editor: props.editor,
    blockName: useMaybeBlockName(),
    blockId: useMaybeBlockId(),
    onUserMention: props.onUserMention,
    onDocumentMention: props.onDocumentMention,
    onEmailMention: props.onEmailMention,
    disableMentionTracking: props.disableMentionTracking,
  });

  const itemAction = async (item: MentionItem) => {
    analytics.track('mentions_menu_use', { itemType: item.kind });
    await itemActionHandler(item);
  };

  createEffect(() => {
    if (props.anchor) return;
    if (menuOpen()) {
      setMountSelection(document.getSelection());
      controller.reset();
      if (isMobile()) {
        controller.viewAll('all');
      }
    } else {
      setMountSelection(null);
    }
  });

  const closeMenu = () => {
    props.editor.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
  };

  useMenuKeyboardNavigation({
    isActive: menuOpen,
    onUp: () => {
      controller.selectPrev();
    },
    onDown: () => {
      controller.selectNext();
    },
    onLeft: () => {
      if (controller.isViewAllMode()) {
        controller.exitViewAll();
      }
    },
    onRight: () => {
      if (!controller.isViewAllMode()) {
        const currentCategory = controller.selectedCategory();
        if (currentCategory) {
          if (
            controller.canViewAllForCategory(currentCategory) ||
            (emailUnifiedSearchInfiniteQuery.hasNextPage &&
              currentCategory === 'emails')
          ) {
            controller.viewAll(currentCategory);
          }
        }
      }
    },
    onSelect: () => {
      const selectedItem = controller.selectedItem();
      if (selectedItem) {
        itemAction(selectedItem);
      } else {
        closeMenu();
      }
      props.menu.setSearchTerm('');
      setMenuOpen(false);
    },
    onClose: () => {
      if (controller.isViewAllMode()) {
        controller.exitViewAll();
      } else {
        closeMenu();
      }
    },
    onSpace: () => {
      switch (escapeSpaceState()) {
        case 'single':
        case 'start':
          closeMenu();
          return true;
        case null:
          setEscapeSpaceState('single');
          return false;
      }
      return false;
    },
    onOtherKey: () => {
      setEscapeSpaceState(null);
    },
  });

  const focusOut = () => {
    closeMenu();
  };

  onMount(() => {
    document.addEventListener('focusout', focusOut);
    onCleanup(() => {
      document.removeEventListener('focusout', focusOut);
    });
  });

  createEffect(() => {
    const items = controller.combinedItems();
    if (!items) return;

    if (
      controller.selectedIndex() >= items.length - 5 &&
      controller.viewAllMode() === 'emails' &&
      emailUnifiedSearchInfiniteQuery.hasNextPage &&
      !emailUnifiedSearchInfiniteQuery.isFetching
    ) {
      emailUnifiedSearchInfiniteQuery.fetchNextPage();
    }
    if (controller.selectedIndex() >= items.length) {
      controller.selectItem(items.length - 1);
    }
  });

  const handleViewAll = (binType: string) => {
    controller.viewAll(binType);
  };

  const handleBackToAll = () => {
    controller.exitViewAll();
  };

  const viewAllCategoryLabel = () => {
    const mode = controller.viewAllMode();
    if (!mode) return 'Items';
    const bucket = bucketConfigs().find((b) => b.id === mode);
    return bucket?.label || 'Items';
  };

  const visibleBuckets = () => {
    const currentBins = controller.bins();
    const seenIds = new Set<string>(blockId ? [blockId] : []);
    let cumulativeIndex = 0;

    return bucketConfigs()
      .filter((config) => (currentBins[config.id] || 0) > 0)
      .map((config) => {
        const bucketLimit = currentBins[config.id] || 0;
        const bucketItems: ReturnType<typeof config.getData> = [];

        for (const item of config.getData()) {
          if (bucketItems.length >= bucketLimit) break;
          if (seenIds.has(item.id)) continue;
          seenIds.add(item.id);
          bucketItems.push(item);
        }

        const startIndex = cumulativeIndex;
        cumulativeIndex += bucketItems.length;
        return { config, bucketItems, startIndex };
      });
  };

  const clickOutsideHandler = (e: MouseEvent) => {
    e.stopPropagation();
    props.editor.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
  };

  const [menuAvailableHeight, setMenuAvailableHeight] = createSignal<
    number | undefined
  >(undefined);

  // Height available for scrollable content after subtracting Surface decorations.
  // Capped at 256px (16rem) to preserve desktop behavior, and floored at 0.
  const contentMaxHeight = () => {
    const h = menuAvailableHeight();
    if (h === undefined) return undefined;
    return Math.min(256, Math.max(0, h - PANEL_DECORATION_HEIGHT));
  };

  const floatWithElementProps = () =>
    props.anchor
      ? {
          element: () => props.anchor,
          useBlockBoundary: props.useBlockBoundary,
        }
      : undefined;

  const floatWithSelectionProps = () =>
    !props.anchor
      ? {
          selection: untrack(mountSelection),
          reactiveOnContainer: props.editor.getRootElement(),
          useBlockBoundary: props.useBlockBoundary,
          onAvailableHeight: setMenuAvailableHeight,
        }
      : undefined;

  return (
    <Show when={menuOpen()}>
      <ScopedPortal scope={props.portalScope}>
        <div
          class="w-96 max-w-[calc(100cqw-1rem-2px)] cursor-default select-none z-modal-content"
          on:touchstart={(e) => e.stopPropagation()}
          ref={(el) => {
            floatWithElement(el, floatWithElementProps);
            floatWithSelection(el, floatWithSelectionProps);
            clickOutside(el, () => clickOutsideHandler);
          }}
        >
          <Surface depth={2} active class="py-2">
            <Show
              when={controller.viewAllMode()}
              fallback={
                <Show
                  when={controller.combinedItems().length > 0}
                  fallback={
                    <div class="px-2 text-ink-extra-muted">No results</div>
                  }
                >
                  <div>
                    <For each={visibleBuckets()}>
                      {(bucket, idx) => (
                        <>
                          <Show when={idx() > 0}>
                            <div class="w-full mt-4 border-b border-edge-muted mb-2" />
                          </Show>
                          <ItemBin
                            label={bucket.config.label}
                            binType={bucket.config.id}
                            totalCount={bucket.config.getFullCount()}
                            showingCount={bucket.bucketItems.length}
                            onViewAll={handleViewAll}
                            isSelected={
                              controller.selectedCategory() === bucket.config.id
                            }
                          >
                            <For each={bucket.bucketItems}>
                              {(item, i) => (
                                <MentionsMenuItem
                                  item={item}
                                  index={bucket.startIndex + i()}
                                  selected={
                                    bucket.startIndex + i() ===
                                    controller.selectedIndex()
                                  }
                                  itemAction={itemAction}
                                  setIndex={setSelectedIndexFromMouse}
                                  setOpen={setMenuOpen}
                                />
                              )}
                            </For>
                          </ItemBin>
                        </>
                      )}
                    </For>
                  </div>
                </Show>
              }
            >
              <Show when={!isMobile()}>
                <div class="px-2 pb-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-medium text-ink-muted">
                      {viewAllCategoryLabel()}
                    </span>
                    <button
                      type="button"
                      class="text-xs font-medium text-ink-muted hover:text-ink hover:underline flex items-center gap-1"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleBackToAll();
                      }}
                    >
                      <div class="p-0.5 px-1 -my-2 bg-surface text-ink border border-edge-muted rounded-xs text-xs">
                        ←
                      </div>
                      Back to everything
                    </button>
                  </div>
                </div>
              </Show>
              <Show when={controller.combinedItems().length === 0}>
                <div class="px-2 text-ink-extra-muted">No results</div>
              </Show>
              <VirtualizedItemList
                items={controller.combinedItems()}
                selectedIndex={controller.selectedIndex()}
                itemAction={itemAction}
                setIndex={setSelectedIndexFromMouse}
                setOpen={setMenuOpen}
                maxHeight={contentMaxHeight()}
              />
            </Show>
          </Surface>
        </div>
      </ScopedPortal>
    </Show>
  );
}

function VirtualizedItemList(props: {
  items: MentionItem[];
  selectedIndex: number;
  itemAction: (item: MentionItem) => void;
  setIndex: (index: number) => void;
  setOpen: (open: boolean) => void;
  maxHeight?: number;
}) {
  let scrollContainerRef: HTMLDivElement | undefined;

  const virtualizer = createVirtualizer({
    get count() {
      return props.items.length;
    },
    getScrollElement: () => scrollContainerRef ?? null,
    estimateSize: () => VIRTUAL_ITEM_HEIGHT,
    overscan: 5,
  });

  // Scroll selected item into view
  createEffect(() => {
    const index = props.selectedIndex;
    if (index >= 0 && index < props.items.length) {
      virtualizer.scrollToIndex(index, { align: 'auto' });
    }
  });

  return (
    <div
      ref={scrollContainerRef}
      class="overflow-y-auto scrollbar-hidden"
      style={{
        'max-height':
          props.maxHeight !== undefined ? `${props.maxHeight}px` : '16rem',
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        <For each={virtualizer.getVirtualItems()}>
          {(virtualRow) => {
            const item = () => props.items[virtualRow.index];
            return (
              <Show when={item()}>
                {(currentItem) => (
                  <div
                    class="ph-no-capture"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <MentionsMenuItem
                      item={currentItem()}
                      index={virtualRow.index}
                      selected={virtualRow.index === props.selectedIndex}
                      itemAction={props.itemAction}
                      setIndex={props.setIndex}
                      setOpen={props.setOpen}
                      disableScrollIntoView
                    />
                  </div>
                )}
              </Show>
            );
          }}
        </For>
      </div>
    </div>
  );
}
