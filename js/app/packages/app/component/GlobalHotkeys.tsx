import { useOpenInstructionsMd } from '@core/component/AI/util/instructions';
import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import {
  isRightPanelOpen,
  useBigChat,
  useToggleRightPanel,
} from '@core/signal/layout';
import { AiInstructionsIcon } from '@service-storage/instructionsMd';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { createMemo } from 'solid-js';
import {
  monochromeIcons,
  setDarkModeTheme,
  setLightModeTheme,
  setMonochromeIcons,
  setThemeShouldMatchSystem,
  themeShouldMatchSystem,
  themes,
} from '../../block-theme/signals/themeSignals';

import { applyTheme } from '../../block-theme/utils/themeUtils';

import {
  konsoleOpen,
  resetKonsoleMode,
  setKonsoleMode,
  toggleKonsoleVisibility,
} from './command/state';
import { CREATABLE_BLOCKS, toggleCreateMenu } from './dock/CreateMenu';
import { fireMacroJump } from './MacroJump';
import {
  quickCreateMenuOpenSignal,
  selectedQuickCreateTypeSignal,
} from './QuickCreateMenu';
import { focusAdjacentSplit } from './split-layout/layoutUtils';
import { fireVisor } from './Visor';

export default function GlobalShortcuts() {
  const [bigChatOpen, setBigChatOpen] = useBigChat();
  const toggleRightPanel = useToggleRightPanel();

  const handleCommandMenu = () => {
    resetKonsoleMode();
    toggleKonsoleVisibility();
    return;
  };

  const handleSearchMenu = () => {
    setKonsoleMode('FULL_TEXT_SEARCH');
    toggleKonsoleVisibility();
    return;
  };

  const createScope = registerHotkey({
    hotkeyToken: TOKENS.global.createCommand,
    hotkey: 'c',
    scopeId: 'global',
    description: 'Create',
    keyDownHandler: () => {
      toggleCreateMenu();
      return true;
    },
    displayPriority: 10,
    activateCommandScope: true,
  });

  CREATABLE_BLOCKS.forEach((item) => {
    registerHotkey({
      hotkeyToken: item.hotkeyToken,
      hotkey: item.hotkey,
      scopeId: createScope.commandScopeId,
      description: item.description,
      keyDownHandler: item.keyDownHandler,
      runWithInputFocused: true,
      displayPriority: 10,
    });
    registerHotkey({
      hotkeyToken: item.altHotkeyToken,
      hotkey: `opt+${item.hotkey}` as ValidHotkey,
      scopeId: createScope.commandScopeId,
      description: `${item.description} in new split`,
      keyDownHandler: item.keyDownHandler,
      runWithInputFocused: true,
      displayPriority: 1,
    });
  });

  const quickCreateScope = registerHotkey({
    hotkeyToken: TOKENS.global.quickCreateCommand,
    hotkey: 'q',
    scopeId: 'global',
    description: 'Quick send',
    keyDownHandler: () => {
      return true;
    },
    activateCommandScope: true,
    displayPriority: 4,
  });

  const [_selectedQuickCreateType, setSelectedQuickCreateType] =
    selectedQuickCreateTypeSignal;
  const [_quickCreateMenuOpen, setQuickCreateMenuOpen] =
    quickCreateMenuOpenSignal;

  registerHotkey({
    hotkeyToken: TOKENS.global.quickCreate.note,
    hotkey: 'n',
    scopeId: quickCreateScope.commandScopeId,
    description: 'Create note',
    keyDownHandler: () => {
      setSelectedQuickCreateType('note');
      setQuickCreateMenuOpen(true);
      return true;
    },
    displayPriority: 10,
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.quickCreate.email,
    hotkey: 'e',
    scopeId: quickCreateScope.commandScopeId,
    description: 'Create email',
    keyDownHandler: () => {
      setSelectedQuickCreateType('email');
      setQuickCreateMenuOpen(true);
      return true;
    },
    displayPriority: 10,
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.quickCreate.message,
    hotkey: 'm',
    scopeId: quickCreateScope.commandScopeId,
    description: 'Create message',
    keyDownHandler: () => {
      setSelectedQuickCreateType('message');
      setQuickCreateMenuOpen(true);
      return true;
    },
    displayPriority: 10,
    runWithInputFocused: true,
  });

  const moveScope = registerHotkey({
    hotkeyToken: TOKENS.global.jumpCommand,
    hotkey: 'm',
    scopeId: 'global',
    description: 'Move',
    keyDownHandler: () => {
      return true;
    },
    activateCommandScope: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.jump.macroJump,
    hotkey: 'm',
    scopeId: moveScope.commandScopeId,
    description: 'Macro Jump',
    keyDownHandler: () => {
      fireMacroJump();
      return true;
    },
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.jump.focusSplitRight,
    hotkey: 'arrowright',
    scopeId: moveScope.commandScopeId,
    description: 'Focus split right',
    keyDownHandler: () => {
      focusAdjacentSplit('right');
      return true;
    },
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.jump.focusSplitLeft,
    hotkey: 'arrowleft',
    scopeId: moveScope.commandScopeId,
    description: 'Focus split left',
    keyDownHandler: () => {
      focusAdjacentSplit('left');
      return true;
    },
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.toggleRightPanel,
    hotkey: 'cmd+/',
    scopeId: 'global',
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
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.commandMenu,
    hotkey: 'cmd+k',
    scopeId: 'global',
    // condition: () => !konsoleOpen(),
    description: () => {
      return konsoleOpen() ? 'Close command menu' : 'Open command menu';
    },
    keyDownHandler: () => {
      handleCommandMenu();
      return true;
    },
    displayPriority: 1,
    hide: true,
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.toggleBigChat,
    hotkey: 'cmd+j',
    scopeId: 'global',
    description: 'Toggle big chat',
    keyDownHandler: () => {
      setBigChatOpen((v) => !v);
      return true;
    },
    runWithInputFocused: true,
  });

  const openInstructions = useOpenInstructionsMd();
  registerHotkey({
    hotkeyToken: TOKENS.global.instructions,
    scopeId: 'global',
    description: 'Open AI instructions',
    keyDownHandler: () => {
      openInstructions();
      return true;
    },
    icon: AiInstructionsIcon,
    runWithInputFocused: true,
  });

  if (ENABLE_SEARCH_SERVICE) {
    registerHotkey({
      hotkeyToken: TOKENS.global.searchMenu,
      hotkey: 'cmd+p',
      scopeId: 'global',
      description: 'Full text search',
      keyDownHandler: () => {
        handleSearchMenu();
        return true;
      },
      runWithInputFocused: true,
      displayPriority: 9,
    });
  }

  const setThemeScope = registerHotkey({
    scopeId: 'global',
    description: 'Change theme',
    keyDownHandler: () => {
      return true;
    },
    activateCommandScope: true,
    runWithInputFocused: true,
    displayPriority: 10,
  });

  themes().forEach((theme) => {
    registerHotkey({
      scopeId: setThemeScope.commandScopeId,
      description: `${theme.name}`,
      keyDownHandler: () => {
        applyTheme(theme.id);
        return true;
      },
      runWithInputFocused: true,
    });
  });

  const setPreferredLightScope = registerHotkey({
    scopeId: 'global',
    description: 'Set preferred light mode theme',
    keyDownHandler: () => {
      return true;
    },
    activateCommandScope: true,
    runWithInputFocused: true,
  });

  themes().forEach((theme) => {
    registerHotkey({
      scopeId: setPreferredLightScope.commandScopeId,
      description: `${theme.name}`,
      keyDownHandler: () => {
        setLightModeTheme(theme.id);
        return true;
      },
      runWithInputFocused: true,
    });
  });

  const setPreferredDarkScope = registerHotkey({
    scopeId: 'global',
    description: 'Set preferred dark mode theme',
    keyDownHandler: () => {
      return true;
    },
    activateCommandScope: true,
    runWithInputFocused: true,
  });

  themes().forEach((theme) => {
    registerHotkey({
      scopeId: setPreferredDarkScope.commandScopeId,
      description: `${theme.name}`,
      keyDownHandler: () => {
        setDarkModeTheme(theme.id);
        return true;
      },
      runWithInputFocused: true,
    });
  });

  registerHotkey({
    scopeId: 'global',
    description: createMemo(
      () =>
        `${themeShouldMatchSystem() ? 'Turn off a' : 'A'}uto detect color scheme`
    ),
    keyDownHandler: () => {
      setThemeShouldMatchSystem((prev) => !prev);
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    scopeId: 'global',
    description: 'Toggle monochrome icons',
    keyDownHandler: () => {
      setMonochromeIcons(!monochromeIcons());
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    scopeId: 'global',
    hotkey: ['escape'],
    description: 'Toggle visor',
    keyDownHandler: () => {
      document.body.classList.toggle('visor-active');
      fireVisor();
      return false;
    },
    runWithInputFocused: true,
  });

  return '';
}
