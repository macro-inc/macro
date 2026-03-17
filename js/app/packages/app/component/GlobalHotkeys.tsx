import { useOpenInstructionsMd } from '@core/component/AI/util/instructions';
import { useSettingsState } from '@core/constant/SettingsState';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { AiInstructionsIcon } from '@queries/storage/instructions-md';
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
import { globalSplitManager } from '../signal/splitLayout';
import { CommandState } from './command';
import { CREATABLE_BLOCKS, setCreateMenuOpen } from './Launcher';
import { useSplitLayout } from './split-layout/layout';
import {
  openFilePicker,
  openFolderPicker,
  handleFolderSelect,
} from '@core/util/upload';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import Upload from '@icon/regular/upload.svg';

export default function GlobalShortcuts() {
  const canFit = () => globalSplitManager()?.canAppendSplit() ?? true;
  const { toggleSettings } = useSettingsState();

  const handleFileUpload = useHandleFileUpload();

  const handleCommandMenu = () => {
    CommandState.toggle();
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
      runWithInputFocused: true,
      keyDownHandler: () => {
        block.keyDownHandler();
        return true;
      },
    });

    if (block.altHotkeyToken) {
      registerHotkey({
        hotkeyToken: block.altHotkeyToken,
        hotkey: `opt+${block.hotkey}` as ValidHotkey,
        scopeId: createCommandScope.commandScopeId,
        description: `${block.description} in new split`,
        runWithInputFocused: true,
        keyDownHandler: () => {
          block.keyDownHandler();
          return true;
        },
      });
    }
  }

  registerHotkey({
    hotkeyToken: TOKENS.global.commandMenu,
    hotkey: 'cmd+k',
    scopeId: 'global',
    description: () => {
      return CommandState.isOpen() ? 'Close command menu' : 'Open command menu';
    },
    keyDownHandler: () => {
      console.log('## CMD K - global');
      handleCommandMenu();
      return true;
    },
    displayPriority: 10,
    hide: CommandState.isOpen,
    runWithInputFocused: true,
  });

  const { openWithSplit } = useSplitLayout();

  const createNewSplit = () => {
    openWithSplit(
      { type: 'component', id: 'inbox' },
      {
        referredFrom: 'hotkey',
        allowDuplicate: true,
        preferNewSplit: true,
      }
    );
    return true;
  };

  registerHotkey({
    hotkeyToken: TOKENS.global.createNewSplit,
    hotkey: 'cmd+\\',
    scopeId: 'global',
    description: 'Create new split',
    condition: canFit,
    keyDownHandler: createNewSplit,
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkey: '\\',
    scopeId: 'global',
    description: 'Create new split',
    condition: canFit,
    keyDownHandler: createNewSplit,
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.toggleSettings,
    hotkey: 'cmd+;',
    scopeId: 'global',
    description: 'Toggle settings',
    keyDownHandler: () => {
      toggleSettings();
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
    description: 'Upload files',
    icon: () => <Upload class="size-4" />,
    keyDownHandler: () => {
      openFilePicker({ multiple: true }, async (files) => {
        await handleFileUpload(files, false);
      });
      return true;
    },
  });

  registerHotkey({
    scopeId: 'global',
    description: 'Upload folders',
    icon: () => <Upload class="size-4" />,
    keyDownHandler: () => {
      openFolderPicker({ multiple: true }, async (files) => {
        await handleFolderSelect(files, async (entries) => {
          await handleFileUpload(entries, false);
        });
      });
      return true;
    },
  });

  return null;
}
