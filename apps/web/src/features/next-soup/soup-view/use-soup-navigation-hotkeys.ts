import { isListViewID } from '@app/constants/list-views';
import {
  isDuplicatePreviewEntityOpen,
  notifyDuplicateContentOpen,
  openEntityInSplitFromUnifiedList,
} from '@app/features/next-soup/utils';
import { globalSplitManager } from '@app/signal/splitLayout';
import type {
  SplitContent,
  SplitEvent,
  SplitEventPayload,
  SplitHandle,
} from '@components/app/split-layout/layoutManager';
import { entityIdSelector } from '@core/dom-selectors';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import { debounce } from '@solid-primitives/scheduled';
import { type Accessor, createEffect, createMemo, onCleanup } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import type { SoupState } from '../create-soup-state';
import { previewContentMatchesEntity } from './preview-content-row';

type UseSoupNavigationHotkeysOptions = {
  scopeId: string;
  soup: SoupState;
  splitHandle: SplitHandle;
  virtualizerHandle: Accessor<VirtualizerHandle | undefined>;
  hasNextPage?: Accessor<boolean>;
  isFetching?: Accessor<boolean>;
  isFetchingNextPage?: Accessor<boolean>;
  fetchNextPage?: () => void;
};

export const useSoupNavigationHotkeys = (
  options: UseSoupNavigationHotkeysOptions
) => {
  const { scopeId, soup, splitHandle, virtualizerHandle } = options;

  const scrollTo = (index: number) => {
    const handle = virtualizerHandle();

    if (!handle) return;

    virtualizerHandle()?.scrollToIndex(index, {
      align: 'nearest',
    });
  };

  const navigationReferredFrom = createMemo(() => {
    const content = splitHandle.content();

    if (content.type === 'component' && isListViewID(content.id)) {
      return content.id;
    }

    const referredFrom = splitHandle.referredFrom();
    return isListViewID(referredFrom) ? referredFrom : undefined;
  });

  // Row focus moves instantly on every keypress; the (expensive) block swap in
  // the Viewer trails the last press. mergeHistory keeps the Viewer's
  // history at a single scanning entry while holding j/k.
  const openInViewerDebounced = debounce((entity: EntityData) => {
    openEntityInSplitFromUnifiedList(entity, {
      splitHandle,
      mergeHistory: true,
      referredFrom: navigationReferredFrom(),
    });
  }, 150);
  onCleanup(() => openInViewerDebounced.clear());

  const openEntity = (entity: EntityData) => {
    if (splitHandle.isControllerSplit()) {
      openInViewerDebounced(entity);
      return;
    }

    const handleContent = splitHandle.content().type;

    if (handleContent === 'component' || handleContent === 'project') return;

    openEntityInSplitFromUnifiedList(entity, {
      splitHandle,
      mergeHistory: true,
      referredFrom: navigationReferredFrom(),
    });
  };

  const navigateToOpenableEntity = (offset: -1 | 1) => {
    let skippedDuplicate = false;
    const next = soup.navigate.by(offset, {
      skip: (row) => {
        if (
          !splitHandle.isControllerSplit() ||
          row.getIsGrouped() ||
          row.getIsLoadMore()
        ) {
          return false;
        }
        const blocked = isDuplicatePreviewEntityOpen(row.original, splitHandle);
        skippedDuplicate ||= blocked;
        return blocked;
      },
    });
    if (skippedDuplicate) notifyDuplicateContentOpen();
    return next;
  };

  /**
   * The row this preview-split content corresponds to, if it lives in this
   * list. Channel messages/threads open as their channel, so those rows are
   * matched through their channelId.
   */
  const rowForPreviewContent = (content: SplitContent) =>
    soup.rows().find((row) => {
      if (row.getIsGrouped() || row.getIsLoadMore()) return false;
      const entity = row.original as EntityData;
      if (!entity) return false;
      return previewContentMatchesEntity(content, entity);
    });

  // Preview history → list selection: stepping the Viewer's history
  // back or forward to content that was opened from this list re-selects the
  // corresponding row.
  createEffect(() => {
    const viewerId = splitHandle.viewerId();
    if (!viewerId) return;
    const viewer = globalSplitManager()?.getSplit(viewerId);
    if (!viewer) return;

    const syncSelection = (
      payload: SplitEventPayload[SplitEvent.ContentChange]
    ) => {
      if (
        payload.cause !== 'history-back' &&
        payload.cause !== 'history-forward'
      ) {
        return;
      }
      const row = rowForPreviewContent(payload.newContent);
      if (!row) return;
      const result = soup.navigate.toId(row.id);
      if (result) scrollTo(result.index);
    };

    viewer.registerContentChangeListener(syncSelection);
    onCleanup(() => viewer.unregisterContentChangeListener(syncSelection));
  });

  const navigateAndSelectEntity = (offset: number) => {
    const nextRow = soup.navigate.by(offset);
    if (!nextRow) return true;
    soup.selection.select(nextRow.row.original);
    scrollTo(nextRow.index);
    return true;
  };

  const handleNavigationSelection = (offset: number) => {
    const focusedEntity = soup.focus.item();
    const next = soup.navigate.peekOffset(offset);

    const selection = soup.selection;

    const nextEntity = next?.row.original;
    if (!nextEntity) return true;

    // At the boundary (top/bottom), peekOffset clamps and returns the
    // same item we're already focused on. No-op to avoid toggling.
    if (focusedEntity && nextEntity.id === focusedEntity.id) return true;

    if (!focusedEntity) {
      navigateAndSelectEntity(offset);
      return true;
    }

    if (selection.count() === 0) {
      selection.toggle(focusedEntity);
      return true;
    }

    if (
      !selection.isSelected(focusedEntity.id) &&
      !selection.isSelected(nextEntity.id)
    ) {
      selection.toggle(focusedEntity);
      navigateAndSelectEntity(offset);
      return true;
    }

    if (selection.isSelected(nextEntity.id)) {
      selection.toggle(focusedEntity);
      soup.navigate.by(offset);
      scrollTo(next.index);
      return true;
    }

    navigateAndSelectEntity(offset);

    return true;
  };

  const group = createHotkeyGroup();

  const { fetchNextPage, isFetching, isFetchingNextPage, hasNextPage } =
    options;

  const LOAD_MORE_DISTANCE_FROM_END = 3;

  const fetchNextPageIfNeeded = () => {
    if (!hasNextPage?.() || isFetching?.() || isFetchingNextPage?.()) return;
    fetchNextPage?.();
  };

  const navigateDown = () => {
    const rowCount = soup.rows().length;
    const next = navigateToOpenableEntity(1);

    if (!next) {
      fetchNextPageIfNeeded();
      return true;
    }

    scrollTo(next.index);
    openEntity(next.row.original);

    if (next.index >= rowCount - 1 - LOAD_MORE_DISTANCE_FROM_END) {
      fetchNextPageIfNeeded();
    }

    return true;
  };

  const navigateUp = () => {
    const next = navigateToOpenableEntity(-1);

    if (!next) return true;

    scrollTo(next.index);
    openEntity(next.row.original);

    return true;
  };

  const canRunListNavigation = () => {
    const contentType = splitHandle.content().type;
    const referredFrom = navigationReferredFrom();
    return (
      contentType === 'component' ||
      contentType === 'project' ||
      referredFrom === 'inbox' ||
      referredFrom === 'mail'
    );
  };

  // Keep j/k registered on the split scope after the list unmounts. When an
  // entity is opened from a list into the same split, this lets j/k continue
  // navigating the originating soup list and update the split content.
  registerHotkey({
    hotkey: ['j'],
    scopeId,
    description: 'Down',
    hotkeyToken: TOKENS.entity.step.end,
    condition: canRunListNavigation,
    keyDownHandler: navigateDown,
    hide: true,
  });

  registerHotkey({
    hotkey: ['arrowdown'],
    scopeId,
    description: 'Down',
    keyDownHandler: navigateDown,
    hide: true,
  }).withGroup(group);

  // Keep j/k registered on the split scope after the list unmounts. When an
  // entity is opened from a list into the same split, this lets j/k continue
  // navigating the originating soup list and update the split content.
  registerHotkey({
    hotkey: ['k'],
    scopeId,
    hotkeyToken: TOKENS.entity.step.start,
    description: 'Up',
    condition: canRunListNavigation,
    keyDownHandler: navigateUp,
    hide: true,
  });

  registerHotkey({
    hotkey: ['arrowup'],
    scopeId,
    description: 'Up',
    keyDownHandler: navigateUp,
    hide: true,
  }).withGroup(group);

  // Select up - 'shift+arrowup', 'shift+k'
  registerHotkey({
    hotkey: ['shift+arrowup', 'shift+k'],
    scopeId,
    description: 'Select up',
    hotkeyToken: TOKENS.entity.select.start,
    keyDownHandler: () => {
      return handleNavigationSelection(-1);
    },
    hide: true,
  }).withGroup(group);

  // Select down - 'shift+arrowdown', 'shift+j'
  registerHotkey({
    hotkey: ['shift+arrowdown', 'shift+j'],
    scopeId,
    description: 'Select down',
    hotkeyToken: TOKENS.entity.select.end,
    keyDownHandler: () => {
      return handleNavigationSelection(1);
    },
    hide: true,
  }).withGroup(group);

  const getCollapsibleToggle = () => {
    const focusedId = soup.focus.id();
    if (!focusedId) return undefined;
    const splitEl = document.querySelector(
      `[data-split-id="${splitHandle.id}"]`
    );
    if (!splitEl) return undefined;
    const entityEl = splitEl.querySelector(entityIdSelector(focusedId));
    if (!entityEl) return undefined;
    return entityEl.querySelector(
      'button[data-collapsible-toggle]'
    ) as HTMLButtonElement | null;
  };

  // When the focused row is a group header, drive it toward `targetExpanded`.
  // Returns true if it toggled, false if already in that state, or undefined
  // when the focused row isn't a group header so the caller can fall through.
  const toggleFocusedGroupHeader = (
    targetExpanded: boolean
  ): boolean | undefined => {
    const focusedRow = soup.focus.row();
    if (!focusedRow?.getIsGrouped() || !focusedRow.group) return undefined;
    if (focusedRow.group.isExpanded() === targetExpanded) return false;
    focusedRow.group.toggle();
    return true;
  };

  registerHotkey({
    hotkey: ['h', 'arrowleft'],
    scopeId,
    description: 'Collapse item',
    hotkeyToken: TOKENS.unifiedList.navigation.parent,
    keyDownHandler: () => {
      const groupHandled = toggleFocusedGroupHeader(false);
      if (groupHandled !== undefined) return groupHandled;

      const toggle = getCollapsibleToggle();
      if (toggle?.dataset.collapsibleState === 'expanded') {
        toggle.click();
        return true;
      }

      // From a child row, collapse its parent group and focus the header.
      const focusedGroup = soup.focus.row()?.group;
      if (focusedGroup?.isExpanded()) {
        focusedGroup.toggle();
        const header = soup.navigate.toId(`header:${focusedGroup.key}`);
        if (header) scrollTo(header.index);
        return true;
      }

      return false;
    },
    registrationType: 'add',
    handlerPriority: 4,
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['l', 'arrowright'],
    scopeId,
    description: 'Expand item',
    hotkeyToken: TOKENS.unifiedList.navigation.child,
    keyDownHandler: () => {
      const groupHandled = toggleFocusedGroupHeader(true);
      if (groupHandled !== undefined) return groupHandled;

      const toggle = getCollapsibleToggle();
      if (toggle?.dataset.collapsibleState === 'collapsed') {
        toggle.click();
        return true;
      }

      return false;
    },
    registrationType: 'add',
    handlerPriority: 4,
    hide: true,
  }).withGroup(group);

  onCleanup(() => group.dispose());
};
