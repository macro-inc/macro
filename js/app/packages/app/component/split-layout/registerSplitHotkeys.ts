import { TOKENS } from '@core/hotkey/tokens';
import {
  isRightPanelOpen,
  useBigChat,
  useToggleRightPanel,
} from '@core/signal/layout';
import type { ViewId } from '@core/types/view';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { globalSplitManager } from '../../signal/splitLayout';
import { fireMacroJump } from '../MacroJump';
import type { ReferredFrom, SplitContent } from './layoutManager';
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
  setSelectedView: (view: ViewId) => void;
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
    replaceSplit,
    splitName,
    getSplitCount,
    isNotUnifiedList,
  } = args;
  const splitManager = globalSplitManager();
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

  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'h',
    description: 'Go home',
    condition: isNotUnifiedList,
    keyDownHandler: () => {
      replaceSplit({
        content: { type: 'component', id: 'unified-list' },
        referredFrom: 'hotkey',
      });
      return true;
    },
    registrationType: 'add',
    hotkeyToken: TOKENS.split.goHome,
    displayPriority: 8,
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

  // AI side panel - legacy binding.
  const [bigChatOpen] = useBigChat();
  const toggleRightPanel = useToggleRightPanel();
  registerHotkey({
    hotkeyToken: TOKENS.split.go.toggleRightPanel,
    hotkey: 'cmd+/',
    scopeId: splitHotkeyScope,
    description: () => {
      return isRightPanelOpen() ? 'Close AI panel' : 'Open AI panel';
    },
    keyDownHandler: () => {
      // Always allow closing. Only allow opening when big chat is not open.
      toggleRightPanel(!isRightPanelOpen());
      return true;
    },
    condition: () => !bigChatOpen() || isRightPanelOpen(),
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
    hotkey: ['arrowright'],
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
    hotkey: ['arrowleft'],
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
