import { TOKENS } from '@core/hotkey/tokens';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { globalSplitManager } from '../../signal/splitLayout';
import { fireMacroJump } from '../MacroJump';
import type { ReferredFrom, SplitContent } from './layoutManager';
import { focusAdjacentSplit } from './layoutUtils';
import { canSpotlight } from './utils/canSpotlight';
import { LIST_VIEW_ID } from '@app/constants/list-views';

export function registerSplitHotkeys(args: {
  splitHotkeyScope: string;
  insertSplit: (content: SplitContent) => void;
  closeSplit: () => void;
  toggleSpotlight: () => void;
  canGoBack: () => boolean;
  goBack: () => void;
  canGoForward: () => boolean;
  goForward: () => void;
  replaceSplit: (options: {
    content: SplitContent;
    referredFrom?: ReferredFrom;
  }) => void;
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
    replaceSplit,
  } = args;
  const splitManager = globalSplitManager();
  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'cmd+escape',
    condition: () => getSplitCount() > 1 || isNotUnifiedList(),
    description: () => (getSplitCount() > 1 ? 'Close split' : 'Go home'),
    keyDownHandler: () => {
      if (getSplitCount() > 1) {
        closeSplit();
      } else {
        replaceSplit({
          content: { type: 'component', id: LIST_VIEW_ID.inbox },
          referredFrom: 'hotkey',
        });
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

  // Macro Jump - legacy binding.
  registerHotkey({
    hotkeyToken: TOKENS.split.go.macroJump,
    hotkey: 'cmd+m',
    scopeId: splitHotkeyScope,
    description: 'Macro Jump',
    keyDownHandler: () => {
      fireMacroJump();
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.window.focusSplitRight,
    hotkey: ['l', 'arrowright'],
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
    hotkey: ['h', 'arrowleft'],
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
