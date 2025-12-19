import { TOKENS } from '@core/hotkey/tokens';
import type { ViewId } from '@core/types/view';
import { registerHotkey } from 'core/hotkey/hotkeys';
import type { SplitContent } from './layoutManager';
import { focusAdjacentSplit } from './layoutUtils';

export function registerSplitHotkeys(args: {
  splitHotkeyScope: string;
  insertSplit: (content: SplitContent) => void;
  closeSplit: () => void;
  toggleSpotlight: () => void;
  canGoBack: () => boolean;
  goBack: () => void;
  canGoForward: () => boolean;
  goForward: () => void;
  setSelectedView: (view: ViewId) => void;
  replaceSplit: (content: SplitContent) => void;
  splitName: () => string;
  getSplitCount: () => number;
  isNotUnifiedList: () => boolean;
}) {
  const { splitHotkeyScope, closeSplit, replaceSplit, getSplitCount, isNotUnifiedList } =
    args;
  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'cmd+escape',
    condition: () => getSplitCount() > 1,
    description: `Close split`,
    keyDownHandler: () => {
      closeSplit();
      return true;
    },
    hotkeyToken: TOKENS.split.close,
  });

  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'h',
    description: 'Go home',
    condition: isNotUnifiedList,
    keyDownHandler: () => {
      replaceSplit({ type: 'component', id: 'unified-list' });
      return true;
    },
    hotkeyToken: TOKENS.split.goHome,
    displayPriority: 8,
  });

  registerHotkey({
    hotkeyToken: TOKENS.window.focusSplitRight,
    hotkey: ['arrowright'],
    scopeId: splitHotkeyScope,
    description: 'Focus split right',
    condition: () => getSplitCount() > 1,
    keyDownHandler: () => {
      focusAdjacentSplit('right');
      return true;
    },
  });

  registerHotkey({
    hotkeyToken: TOKENS.window.focusSplitLeft,
    hotkey: ['arrowleft'],
    scopeId: splitHotkeyScope,
    description: 'Focus split left',
    condition: () => getSplitCount() > 1,
    keyDownHandler: () => {
      focusAdjacentSplit('left');
      return true;
    },
  });

  return {};
}
