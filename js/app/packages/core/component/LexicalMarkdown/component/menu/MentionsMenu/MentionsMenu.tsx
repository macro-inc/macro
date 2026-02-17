import type { BlockName } from '@core/block';
import { useMaybeBlockId, useMaybeBlockName } from '@core/block';
import { SUPPORTED_CHAT_ATTACHMENT_BLOCKS } from '@core/component/AI/constant/fileType';
import { type PortalScope, ScopedPortal } from '@core/component/ScopedPortal';
import { useQuickAccess, type EntityItem } from '@core/context/quickAccess';
import clickOutside from '@core/directive/clickOutside';
import type { ChannelWithParticipants, IUser } from '@core/user';
import { useDateSearch } from '@core/util/dateSearch/useDateSearch';
import { useIsKeyPressActive } from '@core/util/useIsKeyPressActive';
import type { EmailEntity } from '@entity';
import { globalSplitManager } from 'app/signal/splitLayout';
import type { LexicalEditor } from 'lexical';
import type { List } from 'lodash';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  type JSXElement,
  onCleanup,
  onMount,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { createLazyMemo } from '@solid-primitives/memo';
import { Dynamic } from 'solid-js/web';
import { floatWithElement } from '../../../directive/floatWithElement';
import { floatWithSelection } from '../../../directive/floatWithSelection';
import { CLOSE_INLINE_SEARCH_COMMAND } from '../../../plugins';
import type { MenuOperations } from '../../../shared/inlineMenu';
import type {
  DateMentionItem,
  UserMentionRecord,
} from '../../../utils/mentionsUtils';
import type { HistoryItem as Item } from '@queries/history/history';
import { ClippedPanel } from '@core/component/ClippedPanel';
import { debouncedDependent } from '@core/util/debounce';
import type { BucketConfig } from './MentionsMenuController';
import { useMentionsMenuController } from './MentionsMenuController';
import { ItemBin, MentionsMenuItem } from './components/index';
import { createItemHandler } from './utils';
import {
  useUsersMention,
  useEntityMention,
  useEmailSearchMention,
} from './hooks';
import { useMenuKeyboardNavigation } from '../useMenuKeyboardNavigation';

const MAX_ITEMS = 8;

export type MentionsMenuProps = {
  editor: LexicalEditor;
  menu: MenuOperations;
  /** pass in a custom users list if necessary */
  users?: Accessor<IUser[]>;
  /** whether the menu checks against block boundary in floating middleware. uses floating-ui default if false. */
  useBlockBoundary?: boolean;
  portalScope?: PortalScope;
  block?: BlockName;
  anchor?: HTMLElement | null;
  onUserMention?: (mention: UserMentionRecord) => void;
  onDocumentMention?: (item: Item | ChannelWithParticipants) => void;
  onEmailMention?: (item: EmailEntity) => void;
  disableMentionTracking?: boolean;
  useSnapshotForDocuments?: boolean;
};

export function MentionsMenu(props: MentionsMenuProps) {
  return (
    <Suspense>
      <MentionsMenuInner {...props} />
    </Suspense>
  );
}

function MentionsMenuInner(props: MentionsMenuProps) {
  const searchTerm = debouncedDependent(props.menu.searchTerm, 60);

  const quickAccess = useQuickAccess();

  const allItems = quickAccess.useList();

  const { isKeypressActive } = useIsKeyPressActive();

  const { usersAndGroups } = useUsersMention({
    users: props.users,
    searchTerm,
    isChannelBlock: props.block === 'channel',
    blockId: useMaybeBlockId(),
  });

  const { entities: docs } = useEntityMention({
    buckets: ['note', 'task', 'document', 'project'],
    searchTerm,
  });

  const { entities: channels } = useEntityMention({
    buckets: ['channel'],
    searchTerm,
  });

  const { emails, emailSearchQuery: emailUnifiedSearchInfiniteQuery } =
    useEmailSearchMention({
      searchTerm,
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

  // Get open tabs from split manager (used for potential future bucket)
  const _openTabs = createLazyMemo(() => {
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

  const bucketConfigs = createLazyMemo((): BucketConfig[] => {
    return [
      {
        id: 'users',
        label: 'People & Groups',
        getData: () => usersAndGroups() ?? [],
        getFullCount: () => usersAndGroups()?.length ?? 0,
      },
      {
        id: 'documents',
        label: 'Documents & Tasks',
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
    ].filter((bucket) => bucket.getFullCount() > 0);
  });

  const controller = useMentionsMenuController(bucketConfigs, {
    maxItems: MAX_ITEMS,
  });

  const [escapeSpaceState, setEscapeSpaceState] = createSignal<
    'start' | 'single' | 'double' | null
  >('start');

  createEffect(() => {
    if (!menuOpen()) {
      setEscapeSpaceState('start');
      controller.reset();
    }
  });

  const itemAction = createItemHandler({
    editor: props.editor,
    blockName: useMaybeBlockName(),
    blockId: useMaybeBlockId(),
    onUserMention: props.onUserMention,
    onDocumentMention: props.onDocumentMention,
    onEmailMention: props.onEmailMention,
    disableMentionTracking: props.disableMentionTracking,
    useSnapshotNode: props.useSnapshotForDocuments,
  });

  createEffect(() => {
    if (props.anchor) return;
    if (menuOpen()) {
      setMountSelection(document.getSelection());
      controller.reset();
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
        case 'double':
        case 'start':
          closeMenu();
          return true;
        case 'single':
          setEscapeSpaceState('double');
          return false;
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

  const hasOnlyOneCategory = controller.hasOnlyOneCategory;

  const inner = createLazyMemo(() => {
    const currentViewAllMode = controller.viewAllMode();

    if (currentViewAllMode) {
      const allItems = controller.combinedItems();
      const totalLength = () => allItems.length;

      const renderViewAllOptions = createLazyMemo(() => {
        const bucket = bucketConfigs().find((b) => b.id === currentViewAllMode);
        const categoryLabel = bucket?.label || 'Items';

        return (
          <>
            <div class="px-2 pb-2">
              <div class="flex items-center justify-between">
                <span class="text-xs font-medium text-ink-muted">
                  {categoryLabel}
                </span>
                <button
                  type="button"
                  class="text-xs font-medium text-ink-muted hover:text-ink hover:underline"
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
                  ←{' '}
                  {hasOnlyOneCategory()
                    ? 'Back to summary'
                    : 'Back to everything'}
                </button>
              </div>
            </div>
            <div class="max-h-64 overflow-y-auto scrollbar-hidden">
              <For each={allItems}>
                {(item, i) => (
                  <MentionsMenuItem
                    item={item}
                    index={i()}
                    selected={i() === controller.selectedIndex()}
                    itemAction={itemAction}
                    setIndex={setSelectedIndexFromMouse}
                    setOpen={setMenuOpen}
                  />
                )}
              </For>
            </div>
          </>
        );
      });

      return (
        <Show
          when={totalLength() > 0}
          fallback={<div class="px-2 text-ink-extra-muted">No results</div>}
        >
          {renderViewAllOptions()}
        </Show>
      );
    }

    // ------ NORMAL MODE ------------------------------------------------------
    const currentBins = controller.bins();
    const totalLength = () => controller.combinedItems().length;

    const RenderOptions = () => {
      const options: JSXElement[] = [];
      let cumulativeIndex = 0;

      bucketConfigs().forEach((config) => {
        const bucketLimit = currentBins[config.id] || 0;
        if (bucketLimit === 0) return;

        const bucketItems = config.getData().slice(0, bucketLimit);
        const startIndex = cumulativeIndex;

        options.push(
          <ItemBin
            label={config.label}
            binType={config.id}
            totalCount={config.getFullCount()}
            showingCount={bucketItems.length}
            onViewAll={handleViewAll}
            isSelected={controller.selectedCategory() === config.id}
          >
            <For each={bucketItems}>
              {(item, i) => (
                <MentionsMenuItem
                  item={item}
                  index={startIndex + i()}
                  selected={startIndex + i() === controller.selectedIndex()}
                  itemAction={itemAction}
                  setIndex={setSelectedIndexFromMouse}
                  setOpen={setMenuOpen}
                />
              )}
            </For>
          </ItemBin>
        );

        cumulativeIndex += bucketItems.length;
      });

      return options.map(
        (option: JSXElement, index: number, array: List<JSXElement>) => (
          <>
            {option}
            <Show when={index < array.length - 1}>
              <div class="w-full mt-4 border-b-1 border-edge mb-2" />
            </Show>
          </>
        )
      );
    };

    return (
      <Show
        when={totalLength() > 0}
        fallback={<div class="px-2 text-ink-extra-muted">No results</div>}
      >
        <div>
          <Dynamic component={RenderOptions} />
        </div>
      </Show>
    );
  });

  const clickOutsideHandler = (e: MouseEvent) => {
    e.stopPropagation();
    props.editor.dispatchCommand(CLOSE_INLINE_SEARCH_COMMAND, undefined);
    setMenuOpen(false);
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
        }
      : undefined;

  return (
    <Show when={menuOpen()}>
      <ScopedPortal scope={props.portalScope}>
        <div
          class="w-96 cursor-default select-none z-modal-content"
          ref={(el) => {
            floatWithElement(el, floatWithElementProps);
            floatWithSelection(el, floatWithSelectionProps);
            clickOutside(el, () => clickOutsideHandler);
          }}
        >
          <ClippedPanel active tl class="py-2">
            {inner()}
          </ClippedPanel>
        </div>
      </ScopedPortal>
    </Show>
  );
}
