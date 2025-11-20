import { TOKENS } from '@core/hotkey/tokens';
import {
  isRightPanelOpen,
  useBigChat,
  useToggleRightPanel,
} from '@core/signal/layout';
import type { ViewId } from '@core/types/view';
import { registerHotkey } from 'core/hotkey/hotkeys';
import type { Accessor } from 'solid-js';
import { fireMacroJump } from '../MacroJump';
import type { SplitContent } from './layoutManager';
import { focusAdjacentSplit } from './layoutUtils';

export function registerSplitHotkeys({
  splitHotkeyScope,
  splitName,
  insertSplit,
  closeSplit,
  toggleSpotlight,
  isSpotLight,
  canGoBack,
  goBack,
  canGoForward,
  goForward,
  setSelectedView,
  replaceSplit,
}: {
  splitHotkeyScope: string;
  splitName: Accessor<string>;
  insertSplit: (content: SplitContent) => void;
  closeSplit: () => void;
  toggleSpotlight: () => void;
  isSpotLight: () => boolean;
  canGoBack: () => boolean;
  goBack: () => void;
  canGoForward: () => boolean;
  goForward: () => void;
  setSelectedView: (view: ViewId) => void;
  replaceSplit: (content: SplitContent) => void;
}) {
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
    hotkeyToken: TOKENS.global.createNewSplit,
    hotkey: '\\',
    scopeId: windowScope.commandScopeId,
    description: 'Create new split',
    keyDownHandler: () => {
      insertSplit({ type: 'component', id: 'unified-list' });
      return true;
    },
  });

  registerHotkey({
    scopeId: windowScope.commandScopeId,
    hotkey: 'w',
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
    hotkeyToken: TOKENS.split.spotlight.toggle,
    description: `Spotlight ${splitName()}`,
    keyDownHandler: () => {
      toggleSpotlight();
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    scopeId: splitHotkeyScope,
    hotkey: 'escape',
    hotkeyToken: TOKENS.split.spotlight.close,
    condition: () => isSpotLight(),
    description: `Spotlight ${splitName()}`,
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
    scopeId: goScopeId,
    hotkey: 'e',
    description: 'Go to email',
    keyDownHandler: () => {
      replaceSplit({ type: 'component', id: 'unified-list' });
      setSelectedView('emails');
      return true;
    },
    hotkeyToken: TOKENS.split.go.email,
  });

  registerHotkey({
    scopeId: goScopeId,
    hotkey: 'i',
    description: 'Go to inbox',
    keyDownHandler: () => {
      replaceSplit({ type: 'component', id: 'unified-list' });
      setSelectedView('inbox');
      return true;
    },
    hotkeyToken: TOKENS.split.go.inbox,
  });

  registerHotkey({
    hotkeyToken: TOKENS.split.go.focusSplitRight,
    hotkey: ['arrowright', 'tab'],
    scopeId: goScopeId,
    description: 'Focus split right',
    keyDownHandler: () => {
      focusAdjacentSplit('right');
      return true;
    },
  });

  registerHotkey({
    hotkeyToken: TOKENS.split.go.focusSplitLeft,
    hotkey: ['arrowleft', 'shift+tab'],
    scopeId: goScopeId,
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
      return isRightPanelOpen() ? 'Close AI panel' : 'Go AI panel';
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
