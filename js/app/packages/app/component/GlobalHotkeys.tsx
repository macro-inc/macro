import { useAnalytics } from '@app/component/analytics-context';
import { useSubscribeToKeypress } from '@app/signal/hotkeyRoot';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import { useLogout } from '@core/auth/logout';
import { useOpenInstructionsMd } from '@core/component/AI/util/instructions';
import { toast } from '@core/component/Toast/Toast';
import { LOCAL_ONLY } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { TOKENS } from '@core/hotkey/tokens';
import {
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
} from '@core/util/upload';
import LogoutIcon from '@icon/regular/sign-out.svg';
import Upload from '@icon/regular/upload.svg';
import UserIcon from '@icon/regular/user.svg';
import IconGear from '@macro-icons/macro-gear.svg';
import { AiInstructionsIcon } from '@queries/storage/instructions-md';
import { useMutationUndoContext } from '@queries/undo';
import { debounce } from '@solid-primitives/scheduled';
import { registerHotkey } from 'core/hotkey/hotkeys';
import { createMemo, onCleanup } from 'solid-js';
import {
  monochromeIcons,
  setDarkModeTheme,
  setLightModeTheme,
  setMonochromeIcons,
  setThemeShouldMatchSystem,
  themeShouldMatchSystem,
  themes,
} from '../../theme/signals/themeSignals';
import { applyTheme } from '../../theme/utils/themeUtils';
import { globalSplitManager } from '../signal/splitLayout';
import { CommandState } from './command';
import { createMenuOpen, setCreateMenuOpen } from './Launcher';
import { openMacroMcpSetupModal } from './macro-mcp-setup-modal/MacroMcpSetupModal';
import { useSplitLayout } from './split-layout/layout';

function useHotkeyAnalytics(): void {
  const analytics = useAnalytics();

  const track = (
    description: string,
    token: string | undefined,
    key: string
  ) => {
    analytics.track('hotkey_use', {
      action: description,
      token,
      key,
    });
  };

  const debouncedTrack = debounce(track, 250);

  let lastFired: string | undefined;
  useSubscribeToKeypress((context) => {
    // Only track when a command was actually executed
    if (!context.commandCaptured) return;

    const command = context.commandCaptured;
    const description =
      typeof command.description === 'function'
        ? command.description()
        : command.description;

    const pressedKeysString = context.pressedKeysString;

    // If we keep firing the same key, we can debounce the track call to avoid
    // sending many of the same event (like for tab, j, k, etc.). Otherwise, we
    // can just track normally for unique events
    let trackFn = lastFired === pressedKeysString ? debouncedTrack : track;

    if (lastFired !== pressedKeysString) {
      debouncedTrack.clear();
    }

    trackFn(description, command.hotkeyToken, pressedKeysString);

    lastFired = pressedKeysString;
  });

  onCleanup(() => {
    debouncedTrack.clear();
  });
}

export default function GlobalShortcuts() {
  const canFit = () => globalSplitManager()?.canAppendSplit() ?? true;

  const analytics = useAnalytics();
  const undoCtx = useMutationUndoContext();

  useHotkeyAnalytics();

  const { toggleSettings, openSettings } = useSettingsState();
  const logout = useLogout();

  const handleFileUpload = useHandleFileUpload();

  const handleCommandMenu = () => {
    if (!CommandState.isOpen()) {
      analytics.track('command_menu_open', { from: 'global_hotkey' });
    }
    CommandState.toggle();
  };

  registerHotkey({
    hotkeyToken: TOKENS.global.createCommand,
    hotkey: 'c',
    scopeId: 'global',
    description: 'Create',
    keyDownHandler: () => {
      const willOpen = !createMenuOpen();

      if (willOpen) {
        analytics.track('create_menu_open', { from: 'global_hotkey' });
      }

      setCreateMenuOpen((prev) => !prev);
      return true;
    },
    displayPriority: 10,
    activateCommandScope: true,
  });

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
    analytics.track('split_created', { from: 'global_hotkey' });
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
    hotkey: 'cmd+\\',
    scopeId: 'global',
    description: 'Create new split',
    condition: canFit,
    keyDownHandler: createNewSplit,
    runWithInputFocused: true,
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.createNewSplit,
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

  registerHotkey({
    scopeId: 'global',
    description: 'Account',
    icon: UserIcon,
    keyDownHandler: () => {
      openSettings('Account');
      return true;
    },
    runWithInputFocused: true,
  });

  registerHotkey({
    scopeId: 'global',
    description: 'Logout',
    icon: LogoutIcon,
    keyDownHandler: () => {
      logout();
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

  registerHotkey({
    scopeId: 'global',
    description: 'MCP setup',
    keyDownHandler: () => {
      openMacroMcpSetupModal();
      return true;
    },
    icon: IconGear,
    runWithInputFocused: true,
    displayPriority: 9,
    tags: ['mcp', 'model context protocol', 'setup', 'connect macro'],
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
        analytics.track('theme_changed', { themeId: theme.id });
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
        analytics.track('theme_changed', { themeId: theme.id });
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
        analytics.track('theme_changed', { themeId: theme.id });
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

  if (LOCAL_ONLY) {
    registerHotkey({
      scopeId: 'global',
      description: 'Open hotkey debugger',
      tags: ['debug', 'dev', 'hotkey'],
      keyDownHandler: () => {
        openWithSplit(
          { type: 'component', id: 'hotkey-debugger' },
          {
            referredFrom: 'hotkey',
            allowDuplicate: true,
            preferNewSplit: true,
          }
        );
        return true;
      },
      runWithInputFocused: true,
    });
  }

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

  registerHotkey({
    hotkeyToken: TOKENS.global.undo,
    hotkey: 'cmd+z',
    scopeId: 'global',
    description: 'Undo',
    keyDownHandler: (e) => {
      if (!undoCtx.canUndo()) return false;
      e?.preventDefault();
      undoCtx.undo({ onError: () => toast.failure('Failed to undo') });
      return true;
    },
    condition: () => undoCtx.canUndo(),
  });

  registerHotkey({
    hotkeyToken: TOKENS.global.redo,
    hotkey: 'shift+cmd+z',
    scopeId: 'global',
    description: 'Redo',
    keyDownHandler: (e) => {
      if (!undoCtx.canRedo()) return false;
      e?.preventDefault();
      undoCtx.redo({ onError: () => toast.failure('Failed to redo') });
      return true;
    },
    condition: () => undoCtx.canRedo(),
  });

  return null;
}
