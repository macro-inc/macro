import { TOKENS } from '@core/hotkey/tokens';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { globalSplitManager } from '../../signal/splitLayout';
import type { SplitContent } from './layoutManager';
import { focusAdjacentSplit } from './layoutUtils';
import { canSpotlight } from './utils/canSpotlight';

export function registerSplitHotkeys(args: {
  splitHotkeyScope: string;
  insertSplit: (content: SplitContent) => void;
  closeSplit: () => void;
  toggleSpotlight: () => void;
  canGoBack: () => boolean;
  goBack: () => void;
  canGoForward: () => boolean;
  goForward: () => void;
  goHome: () => void;
  splitName: () => string;
  getSplitCount: () => number;
  isNotUnifiedList: () => boolean;
}) {
  const {
    splitHotkeyScope,
    closeSplit,
    toggleSpotlight,
    canGoBack,
    goBack,
    canGoForward,
    goForward,
    splitName,
    getSplitCount,
    isNotUnifiedList,
    goHome,
  } = args;
  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: ['cmd+escape', 'opt+escape'],
    condition: () => isNotUnifiedList() || getSplitCount() > 1,
    description: () => (isNotUnifiedList() ? 'Go home' : 'Close split'),
    keyDownHandler: () => {
      if (isNotUnifiedList()) {
        goHome();
      } else if (getSplitCount() > 1) {
        closeSplit();
      }
      return true;
    },
    hotkeyToken: TOKENS.split.close,
    runWithInputFocused: true,
  });

  // Spotlight (maximize split) - legacy binding.
  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'shift+escape',
    hotkeyToken: TOKENS.window.spotlight.toggle,
    description: () => `Maximize ${splitName()}`,
    condition: () => {
      const splitManager = globalSplitManager();
      if (!splitManager) return false;
      return canSpotlight(splitManager);
    },
    keyDownHandler: () => {
      toggleSpotlight();
      return true;
    },
    runWithInputFocused: true,
  });

  // History back/forward - legacy bindings.
  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkeyToken: TOKENS.split.go.back,
    hotkey: 'opt+[',
    condition: () => canGoBack(),
    description: `Go back`,
    keyDownHandler: () => {
      goBack();
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkeyToken: TOKENS.split.go.forward,
    hotkey: 'opt+]',
    condition: () => canGoForward(),
    description: `Go forward`,
    keyDownHandler: () => {
      goForward();
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.window.focusSplitRight,
    hotkey: ['shift+l', 'shift+arrowright'],
    scopeId: splitHotkeyScope,
    description: 'Focus split right',
    condition: () => getSplitCount() > 1,
    keyDownHandler: () => {
      focusAdjacentSplit('right');
      return true;
    },
    registrationType: 'add',
  });

  registerHotkey({
    hotkeyToken: TOKENS.window.focusSplitLeft,
    hotkey: ['shift+h', 'shift+arrowleft'],
    scopeId: splitHotkeyScope,
    description: 'Focus split left',
    condition: () => getSplitCount() > 1,
    keyDownHandler: () => {
      focusAdjacentSplit('left');
      return true;
    },
    registrationType: 'add',
  });

  return {};
}
