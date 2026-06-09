import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import type { SplitHandle } from '@app/component/split-layout/layoutManager';
import { isListViewID } from '@app/constants/list-views';
import { entityIdSelector } from '@core/dom-selectors';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import type { SoupState } from '../create-soup-state';

type UseSoupNavigationHotkeysOptions = {
  scopeId: string;
  soup: SoupState;
  splitHandle: SplitHandle;
  virtualizerHandle: Accessor<VirtualizerHandle | undefined>;
  hasNextPage?: Accessor<boolean>;
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

  const openEntity = (entity: EntityData) => {
    const handleContent = splitHandle.content().type;

    if (handleContent === 'component' || handleContent === 'project') return;

    openEntityInSplitFromUnifiedList(entity, {
      splitHandle,
      mergeHistory: true,
      referredFrom: navigationReferredFrom(),
    });
  };

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

  const { fetchNextPage, isFetchingNextPage, hasNextPage } = options;

  const LOAD_MORE_DISTANCE_FROM_END = 3;

  const fetchNextPageIfNeeded = () => {
    if (!hasNextPage?.() || isFetchingNextPage?.()) return;
    fetchNextPage?.();
  };

  const navigateDown = () => {
    const rowCount = soup.rows().length;
    const next = soup.navigate.down();

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
    const next = soup.navigate.up();

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
