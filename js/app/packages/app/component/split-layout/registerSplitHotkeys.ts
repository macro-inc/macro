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
import type { SplitContent } from './layoutManager';
import { focusAdjacentSplit } from './layoutUtils';
import { canSpotlight } from './utils/canSpotlight';

export function registerSplitHotkeys({
  splitHotkeyScope,
  insertSplit,
  closeSplit,
  toggleSpotlight,
  canGoBack,
  goBack,
  canGoForward,
  goForward,
  setSelectedView,
  replaceSplit,
  splitName,
  getSplitCount,
  isNotUnifiedList,
}: {
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
  const splitManager = globalSplitManager();
  const canFit = () =>
    splitManager?.resizeContext()?.canFit({ minSize: 400 }) ?? true;

  const windowScope = registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'w',
    description: 'Window',
    keyDownHandler: () => {
      return true;
    },
    activateCommandScope: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.window.createNewSplit,
    hotkey: '\\',
    scopeId: windowScope.commandScopeId,
    description: 'Create new split',
    condition: canFit,
    keyDownHandler: () => {
      insertSplit({ type: 'component', id: 'unified-list' });
      return true;
    },
  });

  registerHotkey({
    scopeId: windowScope.commandScopeId,
    hotkey: 'w',
    condition: () => getSplitCount() > 1,
    description: `Close split`,
    keyDownHandler: () => {
      closeSplit();
      return true;
    },
    hotkeyToken: TOKENS.window.close,
  });

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
    scopeId: windowScope.commandScopeId,
    hotkey: 'm',
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

  const goScope = registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'g',
    description: 'Go',
    keyDownHandler: () => {
      return true;
    },
    activateCommandScope: true,
    hotkeyToken: TOKENS.split.goCommand,
    displayPriority: 10,
  });

  const goScopeId = goScope.commandScopeId;

  registerHotkey({
    scopeId: goScopeId,
    hotkey: '[',
    hotkeyToken: TOKENS.split.go.back,
    condition: () => canGoBack(),
    description: `Go back`,
    keyDownHandler: () => {
      goBack();
      return true;
    },
  });

  registerHotkey({
    scopeId: goScopeId,
    hotkey: ']',
    hotkeyToken: TOKENS.split.go.forward,
    condition: () => canGoForward(),
    description: `Go forward`,
    keyDownHandler: () => {
      goForward();
      return true;
    },
  });

  registerHotkey({
    scopeId: goScopeId,
    hotkey: 'h',
    description: 'Go home',
    keyDownHandler: () => {
      replaceSplit({ type: 'component', id: 'unified-list' });
      return true;
    },
    hotkeyToken: TOKENS.split.go.home,
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
    scopeId: goScopeId,
    hotkey: 'e',
    description: 'Go to email',
    keyDownHandler: () => {
      replaceSplit({ type: 'component', id: 'unified-list' });
      setSelectedView('email');
      return true;
    },
    hotkeyToken: TOKENS.split.go.email,
  });

  registerHotkey({
    scopeId: goScopeId,
    hotkey: 's',
    description: 'Go to signal',
    keyDownHandler: () => {
      replaceSplit({ type: 'component', id: 'unified-list' });
      setSelectedView('signal');
      return true;
    },
    hotkeyToken: TOKENS.split.go.inbox,
  });

  registerHotkey({
    hotkeyToken: TOKENS.window.focusSplitRight,
    hotkey: ['arrowright', 'tab', 'l'],
    scopeId: windowScope.commandScopeId,
    description: 'Focus split right',
    keyDownHandler: () => {
      focusAdjacentSplit('right');
      return true;
    },
  });

  registerHotkey({
    hotkeyToken: TOKENS.window.focusSplitLeft,
    hotkey: ['arrowleft', 'shift+tab', 'h'],
    scopeId: windowScope.commandScopeId,
    description: 'Focus split left',
    keyDownHandler: () => {
      focusAdjacentSplit('left');
      return true;
    },
  });

  const [bigChatOpen, _] = useBigChat();
  const toggleRightPanel = useToggleRightPanel();

  registerHotkey({
    hotkeyToken: TOKENS.split.go.toggleRightPanel,
    hotkey: 'r',
    scopeId: goScopeId,
    description: () => {
      return isRightPanelOpen() ? 'Close AI panel' : 'Open AI panel';
    },
    keyDownHandler: () => {
      toggleRightPanel();
      return true;
    },
    condition: () => {
      return !bigChatOpen();
    },
  });

  registerHotkey({
    hotkeyToken: TOKENS.split.go.macroJump,
    hotkey: 'j',
    scopeId: goScopeId,
    description: 'Macro Jump',
    keyDownHandler: () => {
      fireMacroJump();
      return true;
    },
  });

  return { windowScope, goScope };
}
