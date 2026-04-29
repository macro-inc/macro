import { CommandState } from '@app/component/command/state';
import type { SplitHandle } from '@app/component/split-layout/layoutManager';
import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import { activeScope, hotkeyScopeTree } from '@core/hotkey/state';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import {
  getHotkeyCommand,
  getScopeElement,
  isScopeInActiveBranch,
  runCommand,
} from '@core/hotkey/utils';
import {
  isSearchEntity,
  isWithNotification,
  filterNotDoneNotifications,
  filterValidNotifications,
} from '@entity';
import { openSingleStackNotification } from '@notifications';
import { globalSplitManager } from '@app/signal/splitLayout';
import { onCleanup, type Accessor } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import type { SoupState } from '../create-soup-state';
import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { VIEW_TAB_PRESETS } from '@app/component/app-sidebar/soup-filter-presets';
import { VIEW_TAB_LISTS, type TabbedListView } from './soup-view-tabs';
import { useAnalytics } from '@app/component/analytics-context';

type UseSoupViewHotkeysOptions = {
  splitId: string;
  scopeId: string;
  soup: SoupState;
  splitHandle: SplitHandle;
  virtualizerHandle: Accessor<VirtualizerHandle | undefined>;
  previewState: Accessor<boolean>;
  currentView: Accessor<ListView | undefined>;
  activeTab: Accessor<string | undefined>;
  applyTabPreset: (view: ListView, tabId: string) => void;
};

export const useSoupViewHotkeys = (options: UseSoupViewHotkeysOptions) => {
  const {
    scopeId,
    soup,
    splitHandle,
    virtualizerHandle,
    previewState,
    currentView,
    activeTab,
    applyTabPreset,
  } = options;

  const analytics = useAnalytics();

  const splitIsUnifiedList = () => isListViewID(splitHandle.content().id);

  // escape - Multi-purpose: Clear selection / Close spotlight
  const clearMultiCondition = () =>
    soup.selection.count() > 0 && splitIsUnifiedList();
  const closeSpotlightCondition = () => splitHandle.isSpotLight();

  const escapeDescription = () => {
    if (clearMultiCondition()) {
      return 'Clear multi selection';
    }
    if (closeSpotlightCondition()) {
      return 'Close spotlight';
    }
    return '';
  };

  const group = createHotkeyGroup();

  // home - Jump to top of list
  registerHotkey({
    hotkey: ['home'],
    scopeId,
    hotkeyToken: TOKENS.entity.jump.home,
    description: 'Go to top of list',
    keyDownHandler: () => {
      const next = soup.navigate.toFirst();
      if (next) {
        virtualizerHandle()?.scrollToIndex(next.index, { align: 'nearest' });
      }
      return true;
    },
    hide: true,
  }).withGroup(group);

  // Register 'g' in the global GO_TO command scope for g+g (jump to top)
  // Uses condition to only run for the soup-view that was focused when 'g' was pressed
  registerHotkey({
    hotkey: GO_TO_LEADER_KEY,
    scopeId: GO_TO_COMMAND_SCOPE,
    description: 'Go to top of list',
    condition: () => isScopeInActiveBranch(scopeId),
    keyDownHandler: () => {
      const next = soup.navigate.toFirst();
      if (next) {
        virtualizerHandle()?.scrollToIndex(next.index, { align: 'nearest' });
      }
      return true;
    },
    registrationType: 'add',
  }).withGroup(group);

  // shift+g, end - Jump to bottom of list
  registerHotkey({
    hotkey: ['shift+g', 'end'],
    scopeId,
    hotkeyToken: TOKENS.entity.jump.end,
    description: 'Go to bottom of list',
    keyDownHandler: () => {
      const next = soup.navigate.toLast();
      if (next) {
        virtualizerHandle()?.scrollToIndex(next.index, { align: 'nearest' });
      }
      return true;
    },
    hide: true,
  }).withGroup(group);

  const tryOpenChannelNotification = (newSplit: boolean): boolean => {
    const entity = soup.focus.item();
    if (!entity) return false;
    if (entity.type !== 'channel' || !isWithNotification(entity)) return false;
    const validNotifs = filterNotDoneNotifications(
      filterValidNotifications(entity.notifications?.() ?? [])
    );
    const splitManager = globalSplitManager();
    return (
      !!splitManager &&
      openSingleStackNotification(validNotifs, splitManager, newSplit)
    );
  };

  // enter - Open entity in split
  registerHotkey({
    hotkey: ['enter'],
    hotkeyToken: TOKENS.entity.open,
    scopeId,
    description: 'Open',
    hide: true,
    keyDownHandler: () => {
      if (tryOpenChannelNotification(false)) return true;

      const entity = soup.focus.item();
      if (!entity) return false;

      const contentHitData = isSearchEntity(entity)
        ? entity.search.contentHitData
        : undefined;
      // Only navigate to specific location if there's exactly one hit
      const location =
        contentHitData?.length === 1 ? contentHitData[0]?.location : undefined;

      openEntityInSplitFromUnifiedList(entity, {
        splitHandle,
        location,
      });
      return true;
    },
    displayPriority: 4,
  }).withGroup(group);

  // cmd+enter - Focus preview block
  registerHotkey({
    hotkey: ['cmd+enter'],
    scopeId,
    description: 'Focus Preview',
    keyDownHandler: () => {
      const preview = previewState();
      const entity = soup.focus.item();
      if (!entity) return false;

      if (preview) {
        // focus inside preview block
        const blockEl = document.getElementById(`block-${entity.id}`);
        if (blockEl) {
          // TODO: use state instead to determine when preview block can receive focus
          blockEl.setAttribute('data-allow-focus-in-preview', '');

          blockEl.focus();
          const getEnterCommand = () => {
            const currentActiveScope = activeScope();
            if (!currentActiveScope) return undefined;
            const activeScopeNode = hotkeyScopeTree.get(currentActiveScope);
            if (!activeScopeNode) return undefined;
            if (activeScopeNode?.type !== 'dom') return;
            const dom = getScopeElement(currentActiveScope);
            if (!dom) return undefined;
            const closestBlockScope = dom.closest(`[id="block-${entity.id}"]`);
            if (
              !closestBlockScope ||
              !(closestBlockScope instanceof HTMLElement)
            )
              return;
            const scopeId = closestBlockScope.dataset.hotkeyScope;
            if (!scopeId) return undefined;

            return getHotkeyCommand(scopeId, 'enter');
          };
          const command = getEnterCommand();
          if (command) {
            runCommand(command);
          }
        }
        return true;
      }

      openEntityInSplitFromUnifiedList(entity, {
        splitHandle,
      });
      return true;
    },
    displayPriority: 4,
  }).withGroup(group);

  // x - Toggle select item
  registerHotkey({
    hotkey: ['x'],
    scopeId,
    description: 'Toggle select item',
    keyDownHandler: () => {
      const entity = soup.focus.item();
      if (!entity) return false;
      soup.selection.toggle(entity);
      return true;
    },
    displayPriority: 10,
  }).withGroup(group);

  // cmd+a - Toggle select all items
  registerHotkey({
    hotkey: ['cmd+a'],
    scopeId,
    description: 'Toggle select all',
    keyDownHandler: (e) => {
      const items = soup.items.data();
      if (items.length === 0) return false;
      e?.preventDefault();
      if (soup.selection.count() === items.length) {
        soup.selection.clear();
      } else {
        soup.selection.set(items.slice());
      }
      return true;
    },
    displayPriority: 10,
  }).withGroup(group);

  // cmd+k - Open command menu with selection context
  // When there's a selection, opens in entity action mode showing only
  // selection modification commands with a preview of the selected entities
  registerHotkey({
    scopeId,
    description: () => {
      return CommandState.isOpen() ? 'Close command menu' : 'Open command menu';
    },
    hotkeyToken: TOKENS.global.commandMenu,
    hotkey: 'cmd+k',
    condition: () => !CommandState.isOpen(),
    keyDownHandler: (e) => {
      console.log('## CMD K - soup view');
      e?.preventDefault();
      const multiSelectEntities = soup.selection.selected();

      if (multiSelectEntities.length > 0) {
        analytics.track('command_menu_open', {
          from: 'soup_view_entity_action',
        });
        // Open in entity action mode with selection
        CommandState.openForEntityAction(multiSelectEntities.slice());
      } else {
        analytics.track('command_menu_open', {
          from: 'soup_view',
        });
        // Normal toggle
        CommandState.toggle();
      }
      return true;
    },
    displayPriority: 10,
    hide: CommandState.isOpen,
    runWithInputFocused: true,
  }).withGroup(group);

  // escape - Multi-purpose: Clear selection / Close spotlight
  registerHotkey({
    hotkey: ['escape'],
    scopeId,
    description: escapeDescription,
    condition: () => clearMultiCondition() || closeSpotlightCondition(),
    keyDownHandler: () => {
      if (clearMultiCondition()) {
        const length = soup.selection.count();
        soup.selection.clear();
        return length > 1;
      }
      if (closeSpotlightCondition()) {
        splitHandle.toggleSpotlight();
        return true;
      }
      return false;
    },
  });

  // shift+enter - Open in new split
  registerHotkey({
    hotkey: ['shift+enter'],
    scopeId,
    description: 'Open in new split',
    condition: () => soup.focus.id() !== undefined,
    keyDownHandler: () => {
      if (tryOpenChannelNotification(true)) return true;

      const entity = soup.focus.item();
      if (!entity) return false;
      openEntityInSplitFromUnifiedList(entity, {
        splitHandle,
        openInNewSplit: true,
      });
      return true;
    },
    hide: true,
  }).withGroup(group);

  const isTabbedView = (v: string): v is TabbedListView => v in VIEW_TAB_LISTS;

  const getTabKeys = () => {
    const view = currentView();
    if (!view || !isTabbedView(view)) return [];
    return VIEW_TAB_LISTS[view].map((t) => t.value);
  };

  const switchToTabIndex = (index: number) => {
    const view = currentView();
    if (!view) return false;
    const tabKeys = getTabKeys();
    if (index < 0 || index >= tabKeys.length) return false;
    applyTabPreset(view, tabKeys[index]!);
    return true;
  };

  // 1-9 number keys to jump to specific tabs
  const tabNumberKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;
  for (let i = 0; i < tabNumberKeys.length; i++) {
    const index = i;
    const key = tabNumberKeys[i]!;
    registerHotkey({
      hotkey: key,
      scopeId,
      hotkeyToken: TOKENS.soup.tabs[key],
      description: `Switch to tab ${key}`,
      condition: () => getTabKeys().length > index,
      keyDownHandler: () => switchToTabIndex(index),
      hide: true,
    }).withGroup(group);
  }

  // fall back to the view's default tab if the soup view active tab accessor
  // returns undefined
  const getCurrentTabIndex = () => {
    const tabKeys = getTabKeys();
    const current = activeTab();
    if (current) {
      const idx = tabKeys.indexOf(current);
      if (idx !== -1) return idx;
    }
    const view = currentView();
    if (!view) return 0;
    const config = VIEW_TAB_PRESETS[view];
    if (!config) return 0;
    const defaultIdx = tabKeys.indexOf(config.default);
    return defaultIdx !== -1 ? defaultIdx : 0;
  };

  // tab - Next tab
  registerHotkey({
    hotkey: ['tab'],
    scopeId,
    hotkeyToken: TOKENS.soup.tabs.next,
    description: 'Next tab',
    condition: () => getTabKeys().length > 1,
    keyDownHandler: () => {
      const view = currentView();
      if (!view) return false;
      const tabKeys = getTabKeys();
      const nextIndex = (getCurrentTabIndex() + 1) % tabKeys.length;
      applyTabPreset(view, tabKeys[nextIndex]!);
      return true;
    },
  }).withGroup(group);

  // shift+tab - Previous tab
  registerHotkey({
    hotkey: ['shift+tab'],
    scopeId,
    hotkeyToken: TOKENS.soup.tabs.prev,
    description: 'Previous tab',
    condition: () => getTabKeys().length > 1,
    keyDownHandler: () => {
      const view = currentView();
      if (!view) return false;
      const tabKeys = getTabKeys();
      const prevIndex =
        (getCurrentTabIndex() - 1 + tabKeys.length) % tabKeys.length;
      applyTabPreset(view, tabKeys[prevIndex]!);
      return true;
    },
  }).withGroup(group);

  onCleanup(() => group.dispose());
};
