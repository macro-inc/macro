import { t } from '@app/lib/i18n';
import { globalSplitManager } from '@app/signal/splitLayout';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
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
  goToList: () => void;
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
    goToList,
  } = args;
  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: ['cmd+escape', 'opt+escape'],
    condition: () => getSplitCount() > 1 || isNotUnifiedList(),
    // Closing wins whenever another split stays visible, matching the frame
    // close button; a sole split falls back to returning to its list.
    description: () =>
      getSplitCount() > 1 ? t('commands.closeSplit') : t('commands.backToList'),
    keyDownHandler: () => {
      if (getSplitCount() > 1) {
        closeSplit();
      } else {
        goToList();
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
    description: () => t('commands.maximizeSplit', { name: splitName() }),
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
    description: () => t('commands.goBack'),
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
    description: () => t('commands.goForward'),
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
    description: () => t('commands.focusSplitRight'),
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
    description: () => t('commands.focusSplitLeft'),
    condition: () => getSplitCount() > 1,
    keyDownHandler: () => {
      focusAdjacentSplit('left');
      return true;
    },
    registrationType: 'add',
  });

  return {};
}
