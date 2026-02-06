import { TOKENS } from '@core/hotkey/tokens';
import type { VirtualizerHandle } from 'virtua/solid';
import type { Accessor } from 'solid-js';
import type { SoupState } from '../create-soup-state';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import { registerHotkey } from '@core/hotkey/hotkeys';

type UseSoupNavigationHotkeysOptions = {
  scopeId: string;
  soup: SoupState;
  virtualizerHandle: Accessor<VirtualizerHandle | undefined>;
  previewPanelRef: Accessor<HTMLElement | undefined>;
};

export const useSoupNavigationHotkeys = (
  options: UseSoupNavigationHotkeysOptions
) => {
  const { scopeId, soup, virtualizerHandle } = options;

  const navigateAndSelectEntity = (offset: number) => {
    const nextRow = soup.navigate.by(offset);
    if (!nextRow) return true;
    soup.selection.select(nextRow.item);
    virtualizerHandle()?.scrollToIndex(nextRow.index, { align: 'nearest' });
    return true;
  };

  const handleNavigationSelection = (offset: number) => {
    const focusedEntity = soup.focus.item();
    const nextIndex = soup.navigate.peekOffset(offset);

    const selection = soup.selection;

    const nextRow = nextIndex?.item;
    if (!nextRow) return true;

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
      !selection.isSelected(nextRow.id)
    ) {
      selection.toggle(focusedEntity);
      navigateAndSelectEntity(offset);
      return true;
    }

    if (selection.isSelected(nextRow.id)) {
      selection.toggle(focusedEntity);
      soup.navigate.by(offset);
      return true;
    }

    navigateAndSelectEntity(offset);

    return true;
  };

  // Navigate down - 'j', 'arrowdown'
  registerHotkey({
    hotkey: ['j', 'arrowdown'],
    scopeId,
    description: 'Down',
    hotkeyToken: TOKENS.entity.step.end,
    keyDownHandler: () => {
      const next = soup.navigate.down();

      if (!next) return true;

      virtualizerHandle()?.scrollToIndex(next.index, { align: 'nearest' });

      return true;
    },
    hide: true,
  });

  // Navigate up - 'k', 'arrowup'
  registerHotkey({
    hotkey: ['k', 'arrowup'],
    scopeId,
    hotkeyToken: TOKENS.entity.step.start,
    description: 'Up',
    keyDownHandler: () => {
      const next = soup.navigate.up();

      if (!next) return true;

      virtualizerHandle()?.scrollToIndex(next.index, { align: 'nearest' });

      return true;
    },
    hide: true,
  });

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
  });

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
  });

  const previewPanel = useMaybePreviewPanel();

  registerHotkey({
    hotkey: ['h', 'arrowleft'],
    scopeId,
    description: 'Navigate to parent context',
    hotkeyToken: TOKENS.unifiedList.navigation.parent,
    keyDownHandler: () => {
      if (!previewPanel) return false;

      previewPanel.onFocusOut();

      return true;
    },
    registrationType: 'add',
    handlerPriority: 4,
    hide: true,
  });

  registerHotkey({
    hotkey: ['l', 'arrowright'],
    scopeId,
    description: 'Navigate to child context',
    hotkeyToken: TOKENS.unifiedList.navigation.child,
    keyDownHandler: () => {
      const previewPanelContent = options.previewPanelRef();
      // If there is no preview or the preview already contains focus, skip
      if (
        !previewPanelContent ||
        previewPanelContent.contains(document.activeElement)
      )
        return false;

      const previewPanelSoup = previewPanelContent?.querySelector(
        'div[data-soup-view]'
      );

      // If it doesn't contain soup, skip
      if (!previewPanelSoup || !(previewPanelSoup instanceof HTMLElement))
        return false;

      previewPanelSoup.focus();
      return true;
    },
    registrationType: 'add',
    handlerPriority: 4,
    hide: true,
  });
};
