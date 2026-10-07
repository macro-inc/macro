import {
  createHotkeyGroup,
  registerHotkey,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { pressedKeys } from '@core/hotkey/state';
import type { ValidHotkey } from '@core/hotkey/types';
import {
  type Accessor,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import {
  matchesLauncherSearch,
  trackLauncherItemUsage,
} from '../launcher-frecency';
import type { CreatableBlock } from '../types';
import {
  type CreateMenuSection,
  createMenuSearchText,
  groupCreateMenuItems,
} from './catalog';

export type VariantLauncherProps = {
  onClose: (shouldReturnFocus?: boolean) => void;
  /** Every entry the menu could bind, available or not. */
  candidates: CreatableBlock[];
  /** The entries on offer right now, after feature gating. */
  available: Accessor<CreatableBlock[]>;
};

type Direction = 'up' | 'down' | 'left' | 'right';

const RESULTS_GROUP = {
  id: 'other',
  label: 'Results',
  tagline: '',
} as const;

function searchRank(item: CreatableBlock, query: string) {
  const q = query.trim().toLowerCase();
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  return 2;
}

/**
 * Behavior shared by every experimental create-menu layout: search,
 * grouping, a selection the keyboard and pointer both drive, and the same
 * hotkeys the classic launcher binds. Layouts only render.
 *
 * Items mark themselves with `data-launcher-index`, and arrow keys move to
 * the nearest item on screen in that direction, so grids, columns and lists
 * all navigate naturally without each layout describing its geometry.
 */
export function useVariantLauncher(
  props: VariantLauncherProps,
  options: {
    autoFocusSearch?: boolean;
    /**
     * `carousel`: one horizontal strip the layout positions itself. Left and
     * right step one entry, up and down jump between groups, and nothing is
     * scrolled into view (the layout centers the selection).
     */
    navigation?: 'spatial' | 'carousel';
  } = {}
) {
  const carousel = options.navigation === 'carousel';
  const hkGroup = createHotkeyGroup();
  const [attachHotkeys, launcherScope] = useHotkeyDOMScope('create-menu', true);

  let rootRef: HTMLElement | undefined;
  let searchRef: HTMLInputElement | undefined;

  const [query, setQueryRaw] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  // Letter hotkeys go to the input while it has focus, so layouts hide them.
  const [searchFocused, setSearchFocused] = createSignal(false);

  const searching = () => query().trim().length > 0;

  const sections = createMemo<CreateMenuSection[]>(() => {
    const available = props.available();
    if (!searching()) return groupCreateMenuItems(available);

    const matches = available
      .filter((item) =>
        matchesLauncherSearch(item, query(), createMenuSearchText(item))
      )
      .map((item, index) => ({ item, index }))
      .sort(
        (a, b) =>
          searchRank(a.item, query()) - searchRank(b.item, query()) ||
          a.index - b.index
      )
      .map(({ item }) => item);

    return matches.length > 0 ? [{ group: RESULTS_GROUP, items: matches }] : [];
  });

  const items = createMemo(() => sections().flatMap((s) => s.items));

  const selected = () => {
    const list = items();
    if (list.length === 0) return undefined;
    return list[Math.min(selectedIndex(), list.length - 1)];
  };

  const isSelected = (item: CreatableBlock) => selected() === item;
  const indexOf = (item: CreatableBlock) => items().indexOf(item);

  const setQuery = (next: string) => {
    setQueryRaw(next);
    setSelectedIndex(0);
  };

  const elementFor = (index: number) =>
    rootRef?.querySelector<HTMLElement>(`[data-launcher-index="${index}"]`);

  const selectIndex = (index: number) => {
    setSelectedIndex(index);
    if (!carousel) elementFor(index)?.scrollIntoView({ block: 'nearest' });
    return true;
  };

  const currentIndex = () => items().indexOf(selected() as CreatableBlock);

  /** Carousel step: wraps around, like the strip itself. */
  const step = (delta: number) => {
    const count = items().length;
    if (count === 0) return false;
    return selectIndex((((currentIndex() + delta) % count) + count) % count);
  };

  /** First entry of the group before or after the selected one. */
  const stepGroup = (delta: -1 | 1) => {
    const list = sections();
    if (list.length <= 1) return step(delta);
    const at = list.findIndex((s) => s.items.includes(selected()!));
    const target = list[Math.max(0, Math.min(list.length - 1, at + delta))];
    const first = target?.items[0];
    return first ? selectIndex(items().indexOf(first)) : false;
  };

  const move = (direction: Direction) => {
    if (!carousel) return selectSpatial(direction);
    if (direction === 'left') return step(-1);
    if (direction === 'right') return step(1);
    // While searching the strip is one flat result list.
    if (searching()) return step(direction === 'up' ? -1 : 1);
    return stepGroup(direction === 'up' ? -1 : 1);
  };

  const selectLinear = (delta: number) => {
    const count = items().length;
    if (count === 0) return false;
    const current = items().indexOf(selected() as CreatableBlock);
    return selectIndex((current + delta + count) % count);
  };

  const selectSpatial = (direction: Direction) => {
    if (!rootRef || items().length === 0) return false;
    const current = items().indexOf(selected() as CreatableBlock);
    const currentEl = elementFor(current);
    if (!currentEl) return selectIndex(0);

    const from = currentEl.getBoundingClientRect();
    const fromX = from.left + from.width / 2;
    const fromY = from.top + from.height / 2;
    const slack = 2;

    const candidates = [
      ...rootRef.querySelectorAll<HTMLElement>('[data-launcher-index]'),
    ]
      .filter((el) => el !== currentEl)
      .map((el) => ({
        index: Number(el.dataset.launcherIndex),
        rect: el.getBoundingClientRect(),
      }))
      .filter(({ rect }) => {
        switch (direction) {
          case 'down':
            return rect.top >= from.bottom - slack;
          case 'up':
            return rect.bottom <= from.top + slack;
          case 'right':
            return (
              rect.left >= from.right - slack &&
              rect.top < from.bottom &&
              rect.bottom > from.top
            );
          case 'left':
            return (
              rect.right <= from.left + slack &&
              rect.top < from.bottom &&
              rect.bottom > from.top
            );
        }
      });

    if (candidates.length === 0) {
      // Off the end of a row: wrap through the reading order instead.
      if (direction === 'right') return selectLinear(1);
      if (direction === 'left') return selectLinear(-1);
      return false;
    }

    const vertical = direction === 'up' || direction === 'down';
    // Nearest row (or column) first, then whatever lines up best within it.
    const along = (rect: DOMRect) =>
      vertical
        ? Math.abs(rect.top + rect.height / 2 - fromY)
        : Math.abs(rect.left + rect.width / 2 - fromX);
    const across = (rect: DOMRect) =>
      vertical
        ? Math.abs(rect.left + rect.width / 2 - fromX)
        : Math.abs(rect.top + rect.height / 2 - fromY);

    const nearestAlong = Math.min(...candidates.map((c) => along(c.rect)));
    const best = candidates
      .filter((c) => along(c.rect) <= nearestAlong + 8)
      .sort((a, b) => across(a.rect) - across(b.rect))[0];

    return best ? selectIndex(best.index) : false;
  };

  const run = (
    item: CreatableBlock | undefined,
    shouldReturnFocus?: boolean
  ) => {
    if (!item || !props.available().includes(item)) return false;
    trackLauncherItemUsage(item);
    item.keyDownHandler();
    props.onClose(shouldReturnFocus);
    return true;
  };

  const focusSearch = () => {
    searchRef?.focus({ preventScroll: true });
    return true;
  };

  props.candidates.forEach((item) => {
    registerHotkey({
      hotkeyToken: item.hotkeyToken,
      hotkey: item.hotkey,
      scopeId: launcherScope,
      description: item.description,
      condition: () => props.available().includes(item),
      registrationType: item.registrationType,
      runWithInputFocused: item.runWithInputFocused,
      keyDownHandler: () => run(item, false),
    }).withGroup(hkGroup);

    if (item.altHotkeyToken) {
      registerHotkey({
        hotkeyToken: item.altHotkeyToken,
        hotkey: `shift+${item.hotkey}` as ValidHotkey,
        scopeId: launcherScope,
        description: `${item.description} in new split`,
        condition: () => props.available().includes(item),
        registrationType: item.registrationType,
        runWithInputFocused: item.runWithInputFocused,
        keyDownHandler: () => run(item),
      }).withGroup(hkGroup);
    }
  });

  registerHotkey({
    hotkey: 'c',
    scopeId: launcherScope,
    description: 'Close Launcher',
    condition: () => !props.available().some((item) => item.hotkey === 'c'),
    registrationType: 'add',
    keyDownHandler: () => {
      props.onClose();
      return true;
    },
  }).withGroup(hkGroup);

  const navUp = registerHotkey({
    hotkey: ['arrowup', 'ctrl+k'],
    scopeId: launcherScope,
    description: 'Navigate up',
    keyDownHandler: (event) => {
      event?.preventDefault();
      return move('up');
    },
    runWithInputFocused: true,
  }).withGroup(hkGroup);

  const navDown = registerHotkey({
    hotkey: ['arrowdown', 'ctrl+j'],
    scopeId: launcherScope,
    description: 'Navigate down',
    keyDownHandler: (event) => {
      event?.preventDefault();
      return move('down');
    },
    runWithInputFocused: true,
  }).withGroup(hkGroup);

  // Left/right stay with the caret while typing a search.
  registerHotkey({
    hotkey: 'arrowleft',
    scopeId: launcherScope,
    description: 'Navigate left',
    keyDownHandler: (event) => {
      event?.preventDefault();
      return move('left');
    },
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: 'arrowright',
    scopeId: launcherScope,
    description: 'Navigate right',
    keyDownHandler: (event) => {
      event?.preventDefault();
      return move('right');
    },
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: 'tab',
    scopeId: launcherScope,
    description: 'Next',
    keyDownHandler: (event) => {
      event?.preventDefault();
      return selectLinear(1);
    },
    runWithInputFocused: true,
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: 'shift+tab',
    scopeId: launcherScope,
    description: 'Previous',
    keyDownHandler: (event) => {
      event?.preventDefault();
      return selectLinear(-1);
    },
    runWithInputFocused: true,
  }).withGroup(hkGroup);

  const searchHotkey = registerHotkey({
    hotkey: '/',
    scopeId: launcherScope,
    description: 'Search',
    keyDownHandler: (event) => {
      event?.preventDefault();
      return focusSearch();
    },
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: 'escape',
    scopeId: launcherScope,
    description: 'Exit',
    keyDownHandler: () => {
      if (query()) {
        setQuery('');
        return true;
      }
      props.onClose();
      return true;
    },
    runWithInputFocused: true,
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: 'shift+enter',
    scopeId: launcherScope,
    description: 'Open in new split',
    keyDownHandler: () => run(selected()),
    runWithInputFocused: true,
  }).withGroup(hkGroup);

  const confirmHotkey = registerHotkey({
    hotkey: 'enter' as ValidHotkey,
    scopeId: launcherScope,
    description: 'Open in current split',
    keyDownHandler: () => run(selected()),
    runWithInputFocused: true,
  }).withGroup(hkGroup);

  onMount(() => {
    if (!rootRef) return;
    attachHotkeys(rootRef);
    queueMicrotask(() => {
      if (options.autoFocusSearch) focusSearch();
      else rootRef?.focus({ preventScroll: true });
    });
  });

  onCleanup(hkGroup.dispose);

  return {
    query,
    setQuery,
    searchFocused,
    setSearchFocused,
    searching,
    sections,
    items,
    selected,
    isSelected,
    indexOf,
    /** Pointer hover: select without scrolling. */
    hover: (item: CreatableBlock) => setSelectedIndex(indexOf(item)),
    select: (item: CreatableBlock) => selectIndex(indexOf(item)),
    step,
    run,
    shiftHeld: () => pressedKeys().has('shift'),
    hotkeys: {
      up: navUp.hotkey,
      down: navDown.hotkey,
      search: searchHotkey.hotkey,
      confirm: confirmHotkey.hotkey,
    },
    setRootRef: (el: HTMLElement) => {
      rootRef = el;
    },
    setSearchRef: (el: HTMLInputElement) => {
      searchRef = el;
    },
  };
}

export type VariantLauncherController = ReturnType<typeof useVariantLauncher>;
