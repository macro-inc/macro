import { useOpenInstructionsMd } from '@core/component/AI/util/instructions';
import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { useBigChat } from '@core/signal/layout';
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
import { fireVisor, resetVisor } from './Visor';
import { openWhichKey, setOpenWhichKey } from './WhichKey';

export default function GlobalShortcuts() {
  const [_, setBigChatOpen] = useBigChat();

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
    // TODO: temporarily hiding this from the command menu, because we need to wire up the create options
    hide: konsoleOpen,
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.commandMenu,
    hotkey: 'cmd+k',
    scopeId: 'global',
    description: () => {
      return konsoleOpen() ? 'Close command menu' : 'Open command menu';
    },
    keyDownHandler: () => {
      handleCommandMenu();
      return true;
    },
    displayPriority: 10,
    hide: konsoleOpen,
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
    hotkeyToken: TOKENS.global.toggleVisor,
    scopeId: 'global',
    hotkey: ['escape'],
    description: 'Toggle visor',
    keyDownHandler: () => {
      if (!openWhichKey()) {
        fireVisor();
        setOpenWhichKey(true);
        return false;
      } else {
        resetVisor();
        setOpenWhichKey(false);
        return false;
      }
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
