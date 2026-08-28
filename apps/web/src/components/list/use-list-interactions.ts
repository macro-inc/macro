import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { ListController } from './create-list-controller';
import type { ListKey, ListNavigationOptions } from './types';

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
    | 'first'
    | 'last'
    | 'open'
    | 'toggleSelection'
    | 'toggleAllVisible'
    | 'clearSelection',
    () => boolean
  >
>;

export type ListInteractionNavigation<TItem> = {
  move?: ListNavigationOptions<TItem>;
  first?: ListNavigationOptions<TItem>;
  last?: ListNavigationOptions<TItem>;
  extendSelection?: ListNavigationOptions<TItem>;
};

export type ListInteractionActivationIntent = 'primary' | 'alternate';

export type ListInteractionActivation<TMetadata> = {
  createMetadata?: (intent: ListInteractionActivationIntent) => TMetadata;
  alternateDescription?: string;
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
  const [selectionAnchor, setSelectionAnchor] = createSignal<
    ListKey | undefined
  >();
  const [rangeSession, setRangeSession] = createSignal<
    | {
        baseline: ReadonlySet<ListKey>;
        selected: boolean;
      }
    | undefined
  >();

  const canHandle = (condition?: () => boolean) =>
    (options.enabled?.() ?? true) && (condition?.() ?? true);

  const scrollFocusedIntoView = () => {
    const index = list.focus.index();
    if (index >= 0) {
      options.scrollHandle()?.scrollToIndex(index, { align: 'nearest' });
    }
  };

  const finishNavigation = (key: ListKey) => {
    setSelectionAnchor(key);
    setRangeSession(undefined);
    scrollFocusedIntoView();
  };

  const move = (offset: 1 | -1) => {
    const result = list.navigate.by(offset, options.navigation?.move);
    if (!result) return false;
    finishNavigation(result.key);
    return true;
  };

  const first = () => {
    const result = list.navigate.toFirst(options.navigation?.first);
    if (!result) return false;
    finishNavigation(result.key);
    return true;
  };

  const last = () => {
    const result = list.navigate.toLast(options.navigation?.last);
    if (!result) return false;
    finishNavigation(result.key);
    return true;
  };

  const beginRange = (selected: boolean) => {
    const existing = rangeSession();
    if (existing) return existing;
    const session = {
      baseline: new Set(list.selection.requestedKeys()),
      selected,
    };
    setRangeSession(session);
    return session;
  };

  const applyRange = (targetKey: ListKey, selected: boolean) => {
    const anchor = selectionAnchor();
    if (
      anchor === undefined ||
      !list.selection.isSelectable(anchor) ||
      !list.selection.isSelectable(targetKey)
    ) {
      return false;
    }

    const session = beginRange(selected);
    list.selection.selectRange(
      anchor,
      targetKey,
      session.selected,
      session.baseline
    );
    return true;
  };

  const setSelected = (
    key: ListKey,
    selected: boolean,
    selectionOptions: { range?: boolean } = {}
  ) => {
    if (!list.selection.isSelectable(key)) return false;
    if (selectionOptions.range && selectionAnchor() !== undefined) {
      return applyRange(key, selected);
    }

    if (selected) list.selection.select(key);
    else list.selection.deselect(key);
    setSelectionAnchor(key);
    setRangeSession(undefined);
    return true;
  };

  const toggleSelected = (
    key: ListKey,
    selectionOptions: { range?: boolean } = {}
  ) => setSelected(key, !list.selection.isSelected(key), selectionOptions);

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
      setSelectionAnchor(firstSelectable.key);
      setRangeSession({
        baseline: new Set(list.selection.requestedKeys()),
        selected: true,
      });
      list.selection.select(firstSelectable.key);
      scrollFocusedIntoView();
      return true;
    }

    const anchor = selectionAnchor();
    if (anchor === undefined || !list.selection.isSelectable(anchor)) {
      setSelectionAnchor(currentKey);
    }
    beginRange(true);

    const result = list.navigate.by(offset, selectionNavigationOptions());
    if (!result || !applyRange(result.key, true)) return false;
    scrollFocusedIntoView();
    return true;
  };

  const toggleAllVisible = () => {
    list.selection.toggleAllVisible();
    setSelectionAnchor(undefined);
    setRangeSession(undefined);
  };

  const clearSelection = () => {
    list.selection.clear();
    setSelectionAnchor(undefined);
    setRangeSession(undefined);
  };

  const group = createHotkeyGroup();

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

  registerHotkey({
    hotkey: 'home',
    hotkeyToken: TOKENS.entity.jump.home,
    scopeId: options.scopeId,
    description: 'Go to first item',
    condition: () => canHandle(options.conditions?.first),
    hide: true,
    keyDownHandler: () => {
      first();
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    hotkey: ['end', 'shift+g'],
    hotkeyToken: TOKENS.entity.jump.end,
    scopeId: options.scopeId,
    description: 'Go to last item',
    condition: () => canHandle(options.conditions?.last),
    hide: true,
    keyDownHandler: () => {
      last();
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
      return key === undefined ? false : toggleSelected(key);
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
      anchor: selectionAnchor,
      set: setSelected,
      toggle: toggleSelected,
      extend: extendSelection,
      toggleAllVisible,
      clear: clearSelection,
      clearAnchor: () => {
        setSelectionAnchor(undefined);
        setRangeSession(undefined);
      },
    },
  };
}
