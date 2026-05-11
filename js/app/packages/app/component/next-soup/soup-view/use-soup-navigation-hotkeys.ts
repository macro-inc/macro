import { openEntityInSplitFromUnifiedList } from '@app/component/next-soup/utils';
import type { SplitHandle } from '@app/component/split-layout/layoutManager';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import { type Accessor, onCleanup } from 'solid-js';
import type { VirtualizerHandle } from 'virtua/solid';
import type { SoupState } from '../create-soup-state';

type UseSoupNavigationHotkeysOptions = {
  scopeId: string;
  soup: SoupState;
  splitHandle: SplitHandle;
  virtualizerHandle: Accessor<VirtualizerHandle | undefined>;
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

  const openEntity = (entity: EntityData) => {
    const handleContent = splitHandle.content().type;

    if (handleContent === 'component' || handleContent === 'project') return;

    openEntityInSplitFromUnifiedList(entity, {
      splitHandle,
      mergeHistory: true,
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

  const navigateDown = () => {
    const next = soup.navigate.down();

    if (!next) return true;

    scrollTo(next.index);
    openEntity(next.row.original);

    return true;
  };

  const navigateUp = () => {
    const next = soup.navigate.up();

    if (!next) return true;

    scrollTo(next.index);
    openEntity(next.row.original);

    return true;
  };

  registerHotkey({
    hotkey: ['j'],
    scopeId,
    description: 'Down',
    hotkeyToken: TOKENS.entity.step.end,
    keyDownHandler: navigateDown,
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['arrowdown'],
    scopeId,
    description: 'Down',
    keyDownHandler: navigateDown,
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['k'],
    scopeId,
    hotkeyToken: TOKENS.entity.step.start,
    description: 'Up',
    keyDownHandler: navigateUp,
    hide: true,
  }).withGroup(group);

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
    const entityEl = splitEl.querySelector(`[data-entity-id="${focusedId}"]`);
    if (!entityEl) return undefined;
    return entityEl.querySelector(
      'button[data-collapsible-toggle]'
    ) as HTMLButtonElement | null;
  };

  registerHotkey({
    hotkey: ['h', 'arrowleft'],
    scopeId,
    description: 'Collapse item',
    hotkeyToken: TOKENS.unifiedList.navigation.parent,
    keyDownHandler: () => {
      const toggle = getCollapsibleToggle();
      if (toggle?.dataset.collapsibleState === 'expanded') {
        toggle.click();
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
