import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isScopeInActiveBranch } from '@core/hotkey/utils';
import { type Accessor, onCleanup } from 'solid-js';
import type { ListController } from './create-list-controller';
import type { ListItemResult, ListNavigationOptions } from './types';

/** Minimal scrolling contract implemented by virtualized list handles. */
export type ListScrollHandle = {
  scrollToIndex: (
    index: number,
    options?: { align?: 'start' | 'center' | 'end' | 'nearest' }
  ) => void;
};

type ListInteractionConditions = Partial<
  Record<
    | 'move'
    | 'extendSelection'
    | 'open'
    | 'toggleSelection'
    | 'toggleAllVisible'
    | 'clearSelection'
    | 'disclosure',
    () => boolean
  >
>;

export type ListInteractionNavigation<TItem> = {
  move?: ListNavigationOptions<TItem>;
  first?: ListNavigationOptions<TItem>;
  last?: ListNavigationOptions<TItem>;
  extendSelection?: ListNavigationOptions<TItem>;
  onNavigate?: (event: ListInteractionNavigationEvent<TItem>) => void;
};

export type ListInteractionNavigationEvent<TItem> =
  | {
      kind: 'move';
      direction: 1 | -1;
      result: ListItemResult<TItem> | undefined;
    }
  | {
      kind: 'first' | 'last';
      result: ListItemResult<TItem> | undefined;
    };

export type ListInteractionActivationIntent = 'primary' | 'alternate';

export type ListInteractionActivation<TMetadata> = {
  createMetadata?: (intent: ListInteractionActivationIntent) => TMetadata;
  alternateDescription?: string;
};

export type ListInteractionDisclosure<TItem> = {
  getKey: (item: TItem) => string | undefined;
  isExpanded: (key: string) => boolean;
  setExpanded: (key: string, expanded: boolean) => void;
  getFocusKey?: (key: string, item: TItem) => string | undefined;
};

export type UseListInteractionsOptions<TItem, TMetadata> = {
  controller: ListController<TItem, TMetadata>;
  scopeId: string;
  scrollHandle: Accessor<ListScrollHandle | undefined>;
  /** Optional view-level gate in addition to hotkey-scope ownership. */
  enabled?: () => boolean;
  conditions?: ListInteractionConditions;
  navigation?: ListInteractionNavigation<TItem>;
  activation?: ListInteractionActivation<TMetadata>;
  disclosure?: ListInteractionDisclosure<TItem>;
};

/**
 * Connects a headless list controller to standard navigation, range selection,
 * scrolling, activation, and hotkeys. Domain-specific row activation remains
 * on the controller supplied by the consuming view.
 */
export function useListInteractions<TItem, TMetadata = unknown>(
  options: UseListInteractionsOptions<TItem, TMetadata>
) {
  const list = options.controller;

  const canHandle = (condition?: () => boolean) =>
    (options.enabled?.() ?? true) && (condition?.() ?? true);

  const scrollFocusedIntoView = () => {
    const index = list.focus.index();
    if (index >= 0) {
      options.scrollHandle()?.scrollToIndex(index, { align: 'nearest' });
    }
  };

  const finishNavigation = (result: ListItemResult<TItem>) => {
    list.selection.setAnchor(result.key);
    scrollFocusedIntoView();
  };

  const move = (offset: 1 | -1) => {
    const result = list.navigate.by(offset, options.navigation?.move);
    options.navigation?.onNavigate?.({
      kind: 'move',
      direction: offset,
      result,
    });
    if (!result) return false;

    finishNavigation(result);
    return true;
  };

  const first = () => {
    const result = list.navigate.toFirst(options.navigation?.first);
    options.navigation?.onNavigate?.({ kind: 'first', result });
    if (!result) return false;

    finishNavigation(result);
    return true;
  };

  const last = () => {
    const result = list.navigate.toLast(options.navigation?.last);
    options.navigation?.onNavigate?.({ kind: 'last', result });
    if (!result) return false;

    finishNavigation(result);
    return true;
  };

  const selectionNavigationOptions = (): ListNavigationOptions<TItem> => {
    const configured = options.navigation?.extendSelection;
    return {
      ...configured,
      isNavigable: (item, index) => {
        const rowKey = list.items.keyOf(item);
        return (
          list.selection.isSelectable(rowKey) &&
          (configured?.isNavigable?.(item, index) ?? true)
        );
      },
    };
  };

  const extendSelection = (offset: 1 | -1) => {
    const currentKey = list.focus.key();
    if (currentKey === undefined) return false;

    if (!list.selection.isSelectable(currentKey)) {
      const firstSelectable = list.navigate.by(
        offset,
        selectionNavigationOptions()
      );
      if (!firstSelectable) return false;

      list.selection.set(firstSelectable.key, true);
      scrollFocusedIntoView();
      return true;
    }

    const anchor = list.selection.anchor();
    if (anchor === undefined || !list.selection.isSelectable(anchor)) {
      list.selection.setAnchor(currentKey);
    }

    const result = list.navigate.by(offset, selectionNavigationOptions());
    if (!result || !list.selection.extendRange(result.key, true)) return false;

    scrollFocusedIntoView();
    return true;
  };

  const toggleAllVisible = () => list.selection.toggleAllVisible();

  const clearSelection = () => list.selection.clear();

  const group = createHotkeyGroup();

  if (options.disclosure) {
    const disclosure = options.disclosure;
    const setExpanded = (expanded: boolean) => {
      const item = list.focus.item();
      if (item === undefined) return false;

      const key = disclosure.getKey(item);
      if (key === undefined || disclosure.isExpanded(key) === expanded) {
        return false;
      }

      disclosure.setExpanded(key, expanded);
      if (expanded) return true;

      const focusKey = disclosure.getFocusKey?.(key, item);
      if (focusKey === undefined) return true;

      list.focus.set(focusKey, { reason: 'keyboard' });
      scrollFocusedIntoView();
      return true;
    };

    registerHotkey({
      hotkey: ['h', 'arrowleft'],
      hotkeyToken: TOKENS.unifiedList.navigation.parent,
      scopeId: options.scopeId,
      description: 'Collapse item',
      condition: () => canHandle(options.conditions?.disclosure),
      keyDownHandler: () => setExpanded(false),
      registrationType: 'add',
      handlerPriority: 4,
      hide: true,
    }).withGroup(group);

    registerHotkey({
      hotkey: ['l', 'arrowright'],
      hotkeyToken: TOKENS.unifiedList.navigation.child,
      scopeId: options.scopeId,
      description: 'Expand item',
      condition: () => canHandle(options.conditions?.disclosure),
      keyDownHandler: () => setExpanded(true),
      registrationType: 'add',
      handlerPriority: 4,
      hide: true,
    }).withGroup(group);
  }

  registerHotkey({
    hotkey: ['arrowdown', 'j'],
    hotkeyToken: TOKENS.entity.step.end,
    scopeId: options.scopeId,
    description: 'Move down',
    condition: () => canHandle(options.conditions?.move),
    hide: true,
    keyDownHandler: () => {
      move(1);
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    hotkey: ['arrowup', 'k'],
    hotkeyToken: TOKENS.entity.step.start,
    scopeId: options.scopeId,
    description: 'Move up',
    condition: () => canHandle(options.conditions?.move),
    hide: true,
    keyDownHandler: () => {
      move(-1);
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    hotkey: 'home',
    hotkeyToken: TOKENS.entity.jump.home,
    scopeId: options.scopeId,
    description: 'Go to first item',
    condition: () => canHandle(options.conditions?.move),
    hide: true,
    keyDownHandler: first,
  }).withGroup(group);

  registerHotkey({
    hotkey: GO_TO_LEADER_KEY,
    scopeId: GO_TO_COMMAND_SCOPE,
    description: 'Go to first item',
    condition: () =>
      canHandle(options.conditions?.move) &&
      isScopeInActiveBranch(options.scopeId),
    keyDownHandler: first,
    registrationType: 'add',
  }).withGroup(group);

  registerHotkey({
    hotkey: ['end', 'shift+g'],
    hotkeyToken: TOKENS.entity.jump.end,
    scopeId: options.scopeId,
    description: 'Go to last item',
    condition: () => canHandle(options.conditions?.move),
    hide: true,
    keyDownHandler: last,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['shift+arrowdown', 'shift+j'],
    scopeId: options.scopeId,
    description: 'Extend selection down',
    condition: () => canHandle(options.conditions?.extendSelection),
    hide: true,
    keyDownHandler: () => {
      extendSelection(1);
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    hotkey: ['shift+arrowup', 'shift+k'],
    scopeId: options.scopeId,
    description: 'Extend selection up',
    condition: () => canHandle(options.conditions?.extendSelection),
    hide: true,
    keyDownHandler: () => {
      extendSelection(-1);
      return true;
    },
  }).withGroup(group);

  const canOpen = () =>
    canHandle(options.conditions?.open) && list.focus.key() !== undefined;
  const open = (intent: ListInteractionActivationIntent) => {
    const metadata = options.activation?.createMetadata?.(intent);
    const activation = list.activate.current({
      reason: 'keyboard',
      ...(metadata === undefined ? {} : { metadata }),
    });
    return activation !== undefined;
  };

  registerHotkey({
    hotkey: 'enter',
    hotkeyToken: TOKENS.entity.open,
    scopeId: options.scopeId,
    description: 'Open item',
    condition: canOpen,
    keyDownHandler: () => open('primary'),
  }).withGroup(group);

  registerHotkey({
    hotkey: 'shift+enter',
    scopeId: options.scopeId,
    description:
      options.activation?.alternateDescription ?? 'Open item alternatively',
    condition: canOpen,
    hide: true,
    keyDownHandler: () => open('alternate'),
  }).withGroup(group);

  const canToggleSelection = () => {
    if (!canHandle(options.conditions?.toggleSelection)) return false;
    const key = list.focus.key();
    return key !== undefined && list.selection.isSelectable(key);
  };

  registerHotkey({
    hotkey: 'x',
    scopeId: options.scopeId,
    description: 'Toggle item selection',
    condition: canToggleSelection,
    keyDownHandler: () => {
      const key = list.focus.key();
      return key === undefined ? false : list.selection.toggle(key);
    },
  }).withGroup(group);

  registerHotkey({
    hotkey: 'cmd+a',
    scopeId: options.scopeId,
    description: 'Toggle all visible items',
    condition: () =>
      canHandle(options.conditions?.toggleAllVisible) &&
      list.selection.visibleKeys().size > 0,
    keyDownHandler: () => {
      toggleAllVisible();
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    hotkey: 'escape',
    hotkeyToken: TOKENS.soup.dismiss,
    scopeId: options.scopeId,
    description: 'Clear selection',
    condition: () =>
      canHandle(options.conditions?.clearSelection) &&
      list.selection.count() > 0,
    keyDownHandler: () => {
      clearSelection();
      return true;
    },
    registrationType: 'add',
  }).withGroup(group);

  onCleanup(() => group.dispose());

  return {
    navigation: {
      move,
      first,
      last,
      scrollFocusedIntoView,
    },
    selection: {
      anchor: list.selection.anchor,
      set: list.selection.set,
      toggle: list.selection.toggle,
      extend: extendSelection,
      toggleAllVisible,
      clear: clearSelection,
      clearAnchor: list.selection.clearAnchor,
    },
  };
}
