import { useOpenInstructionsMd } from '@core/component/AI/util/instructions';
import { ENABLE_SEARCH_SERVICE } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import {
  useBigChat,
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
import { fireVisor, resetVisor } from './Visor';
import { openWhichKey, setOpenWhichKey } from './WhichKey';

export default function GlobalShortcuts() {
  const [_, setBigChatOpen] = useBigChat();

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
    displayPriority: 10,
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

  return '';
}
