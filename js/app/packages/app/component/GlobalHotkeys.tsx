import { useOpenInstructionsMd } from '@core/component/AI/util/instructions';
import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import {
  isRightPanelOpen,
  useBigChat,
  useToggleRightPanel,
} from '@core/signal/layout';
import { AiInstructionsIcon } from '@service-storage/instructionsMd';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { createMemo } from 'solid-js';
import {
  beveledCorners,
  monochromeIcons,
  setBeveledCorners,
  setDarkModeTheme,
  setLightModeTheme,
  setMonochromeIcons,
  setThemeShouldMatchSystem,
  themeShouldMatchSystem,
  themes,
  toggleGutterSize,
} from '../../block-theme/signals/themeSignals';

import { applyTheme } from '../../block-theme/utils/themeUtils';
import { playSound } from '../util/sound';
import {
  konsoleOpen,
  resetKonsoleMode,
  setKonsoleMode,
  toggleKonsoleVisibility,
} from './command/state';
import { CREATABLE_BLOCKS, setCreateMenuOpen } from './Launcher';
import { fireMacroJump } from './MacroJump';
import {
  quickCreateMenuOpenSignal,
  selectedQuickCreateTypeSignal,
} from './QuickCreateMenu';
import type { ValidHotkey } from '@core/hotkey/types';

export default function GlobalShortcuts() {
  const [bigChatOpen, setBigChatOpen] = useBigChat();
  const toggleRightPanel = useToggleRightPanel();

  const handleCommandMenu = () => {
    const wasOpen = konsoleOpen();
    resetKonsoleMode();
    toggleKonsoleVisibility();
    // Play sound when opening (not closing)
    if (!wasOpen) {
      playSound('Kick - Struct - Tight Minimal 4');
    }
    return;
  };

  const handleSearchMenu = () => {
    setKonsoleMode('FULL_TEXT_SEARCH');
    toggleKonsoleVisibility();
    return;
  };

  const createCommandScope = registerHotkey({
    hotkeyToken: TOKENS.global.createCommand,
    hotkey: 'c',
    scopeId: 'global',
    description: 'Create',
    keyDownHandler: () => {
      setCreateMenuOpen((prev) => !prev);
      return true;
    },
    displayPriority: 10,
    activateCommandScope: true,
  });

  for (const block of CREATABLE_BLOCKS) {
    registerHotkey({
      hotkeyToken: block.hotkeyToken,
      hotkey: block.hotkey,
      scopeId: createCommandScope.commandScopeId,
      description: block.description,
      keyDownHandler: () => {
        block.keyDownHandler();
        return true;
      },
      runWithInputFocused: true,
    });

    registerHotkey({
      hotkeyToken: block.altHotkeyToken,
      hotkey: `opt+${block.hotkey}` as ValidHotkey,
      scopeId: createCommandScope.commandScopeId,
      description: `${block.description} in new split`,
      keyDownHandler: () => {
        block.keyDownHandler();
        return true;
      },
      runWithInputFocused: true,
    });
  }

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

  registerHotkey({
    hotkeyToken: TOKENS.global.macroJump,
    hotkey: 'cmd+m',
    scopeId: 'global',
    description: 'Macro jump',
    runWithInputFocused: true,
    keyDownHandler: () => {
      fireMacroJump();
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
    description: 'Toggle beveled corners',
    keyDownHandler: () => {
      setBeveledCorners(!beveledCorners());
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    scopeId: 'global',
    description: 'Toggle gutter size',
    keyDownHandler: () => {
      toggleGutterSize();
      return true;
    },
    runWithInputFocused: true,
  });

  return '';
}
