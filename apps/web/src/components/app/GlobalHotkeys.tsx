import {
  COMMAND_MENU_CATEGORY_LEADER_KEY,
  COMMAND_MENU_CATEGORY_SCOPE,
  CREATE_MENU_COMMAND_SCOPE,
} from '@app/constants/hotkeys';
import { type CategoryFilter, CommandState } from '@app/features/command';
import {
  CREATABLE_BLOCKS,
  createMenuOpen,
  setCreateMenuOpen,
} from '@app/features/command/Launcher';
import { openMacroMcpSetupModal } from '@app/features/integrations/mcp-setup/MacroMcpSetupModal';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSubscribeToKeypress } from '@app/signal/hotkeyRoot';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import {
  automationComposerOpen,
  setAutomationComposerOpen,
} from '@block-automation/component';
import { useLogout } from '@core/auth/logout';
import { useOpenInstructionsMd } from '@core/component/AI/util/instructions';
import { toast } from '@core/component/Toast/Toast';
import { enableSnippets, LOCAL_ONLY } from '@core/constant/featureFlags';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import {
  handleFolderSelect,
  openFilePicker,
  openFolderPicker,
} from '@core/util/upload';
import IconGear from '@icon/macro-gear.svg';
import Plus from '@phosphor/plus.svg';
import LogoutIcon from '@phosphor/sign-out.svg';
import Upload from '@phosphor/upload.svg';
import UserIcon from '@phosphor/user.svg';
import { AiInstructionsIcon } from '@queries/storage/instructions-md';
import { useMutationUndoContext } from '@queries/undo';
import { debounce } from '@solid-primitives/scheduled';
import { ThemeChips } from '@theme/components/ThemeChips';
import {
  darkModeTheme,
  lightModeTheme,
  setDarkModeTheme,
  setLightModeTheme,
  setThemeMode,
  systemMode,
  themeMode,
  themes,
} from '@theme/signals/themeSignals';
import type { ThemeV3 } from '@theme/types/themeTypes';
import {
  applySystemTheme,
  applyTheme,
  clearThemePreview,
  previewTheme,
  resolveActiveThemeId,
} from '@theme/utils/themeUtils';
import { type Component, onCleanup, Show } from 'solid-js';
import { useSplitLayout } from './split-layout/layout';

const COMMAND_MENU_CATEGORY_HOTKEYS: Array<{
  category: CategoryFilter;
  hotkey: ValidHotkey;
  label: string;
}> = [
  { category: 'all', hotkey: 'l', label: 'All' },
  { category: 'commands', hotkey: 'm', label: 'Command' },
  { category: 'chats', hotkey: 'a', label: 'Agents' },
  { category: 'documents', hotkey: 'f', label: 'Files' },
  { category: 'tasks', hotkey: 't', label: 'Tasks' },
  { category: 'channels', hotkey: 'c', label: 'Channels' },
  { category: 'dms', hotkey: 'p', label: 'People' },
];

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

  const { openSettings, settingsOpen, selectTab, toggleSettings } =
    useSettingsState();
  const logout = useLogout();

  const handleFileUpload = useHandleFileUpload();
  const snippetsFlag = useFeatureFlag(enableSnippets);

  const handleCommandMenu = () => {
    const willOpen = !CommandState.isOpen();

    if (willOpen) {
      if (automationComposerOpen()) {
        setAutomationComposerOpen(false, false);
      }

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
      if (automationComposerOpen()) {
        return true;
      }

      const willOpen = !createMenuOpen();

      if (willOpen) {
        analytics.track('create_menu_open', { from: 'global_hotkey' });
      }

      setCreateMenuOpen((prev) => !prev);
      return true;
    },
    displayPriority: 10,
    activateCommandScopeId: CREATE_MENU_COMMAND_SCOPE,
    surfaceNestedCommands: true,
    keywords: ['new', 'make', 'add'],
    icon: Plus,
  });

  CREATABLE_BLOCKS.forEach((item) => {
    registerHotkey({
      hotkeyToken: item.hotkeyToken,
      hotkey: item.hotkey,
      scopeId: CREATE_MENU_COMMAND_SCOPE,
      description: item.description,
      condition: () =>
        (item.condition?.() ?? true) &&
        (item.enabled?.() ?? true) &&
        (item.blockName !== 'snippet' || snippetsFlag().enabled),
      // Entries that deliberately share a key (the flagged agent pair) opt
      // into 'add' so both survive registration and the dispatcher picks the
      // one whose condition passes, rather than the later silently winning.
      registrationType: item.registrationType,
      keyDownHandler: item.keyDownHandler,
      icon: Plus,
      tags: item.tags,
      keywords: item.keywords,
      hide: () =>
        !(item.enabled?.() ?? true) ||
        (item.blockName === 'snippet' && !snippetsFlag().enabled),
      runWithInputFocused: true,
    });
  });

  registerHotkey({
    hotkey: ['c', 'escape'],
    scopeId: CREATE_MENU_COMMAND_SCOPE,
    description: 'Close Create',
    condition: createMenuOpen,
    keyDownHandler: () => {
      setCreateMenuOpen(false);
      return true;
    },
    runWithInputFocused: true,
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

  registerHotkey({
    hotkey: COMMAND_MENU_CATEGORY_LEADER_KEY,
    scopeId: 'global',
    description: 'Open category',
    keyDownHandler: () => true,
    activateCommandScopeId: COMMAND_MENU_CATEGORY_SCOPE,
    surfaceNestedCommands: true,
    keywords: ['command menu', 'palette', 'category'],
  });

  for (const item of COMMAND_MENU_CATEGORY_HOTKEYS) {
    registerHotkey({
      hotkey: item.hotkey,
      scopeId: COMMAND_MENU_CATEGORY_SCOPE,
      description: `Open ${item.label}`,
      keyDownHandler: () => {
        setActiveScope('global');
        CommandState.setCategoryFilter(item.category);
        CommandState.setQuery('');
        CommandState.setSelectedIndex(0);
        CommandState.open();
        return true;
      },
      keywords: ['command menu', 'palette', 'category', item.label],
      runWithInputFocused: true,
    });
  }

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

  // Open settings to a specific tab, switching the page in place if settings
  // are already open.
  const openSettingsAt = (tab?: SettingsTab) => {
    if (settingsOpen()) {
      if (tab) selectTab(tab);
      return;
    }
    openSettings(tab);
  };

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
      openSettingsAt('Account');
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

  const ThemeDisplay: Component<{ theme: ThemeV3 }> = (props) => (
    <div class="flex items-center gap-2">
      {props.theme.name}
      <ThemeChips theme={props.theme} size="sm" />
    </div>
  );

  // The per-mode theme the OS scheme currently resolves to — shown as the
  // "System preference" option's swatch and previewed on highlight.
  const systemResolvedTheme = (): ThemeV3 | undefined =>
    themes().find(
      (theme) =>
        theme.id ===
        (systemMode() === 'dark' ? darkModeTheme() : lightModeTheme())
    );

  const setVisibleTheme = (themeId: string) => {
    const resolvedMode = themeMode() === 'system' ? systemMode() : themeMode();
    if (resolvedMode === 'dark') {
      setDarkModeTheme(themeId);
    } else {
      setLightModeTheme(themeId);
    }
  };

  // "System preference" mirrors the Active-theme dropdown's first option: follow
  // the OS scheme rather than pinning a fixed theme.
  registerHotkey({
    scopeId: setThemeScope.commandScopeId,
    description: 'System preference',
    keyDownHandler: () => {
      applySystemTheme();
      analytics.track('theme_changed', { themeId: 'system' });
      return true;
    },
    runWithInputFocused: true,
    displayComponent: () => (
      <div class="flex items-center gap-2">
        System preference
        <Show when={systemResolvedTheme()}>
          {(theme) => <ThemeChips theme={theme()} size="sm" />}
        </Show>
      </div>
    ),
    onHighlight: () => {
      const theme = systemResolvedTheme();
      if (theme) previewTheme(theme.id);
    },
    onHighlightEnd: clearThemePreview,
  });

  themes().forEach((theme) => {
    registerHotkey({
      scopeId: setThemeScope.commandScopeId,
      description: `${theme.name}`,
      keyDownHandler: () => {
        // Change the theme currently being viewed without switching between
        // static and system-driven theme modes.
        setVisibleTheme(theme.id);
        applyTheme(resolveActiveThemeId());
        analytics.track('theme_changed', { themeId: theme.id });
        return true;
      },
      runWithInputFocused: true,
      displayComponent: () => <ThemeDisplay theme={theme} />,
      onHighlight: () => previewTheme(theme.id),
      onHighlightEnd: clearThemePreview,
    });
  });

  const setPreferredLightScope = registerHotkey({
    scopeId: 'global',
    description: 'Set default light theme',
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
      displayComponent: () => <ThemeDisplay theme={theme} />,
      onHighlight: () => previewTheme(theme.id),
      onHighlightEnd: clearThemePreview,
    });
  });

  const setPreferredDarkScope = registerHotkey({
    scopeId: 'global',
    description: 'Set default dark theme',
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
      displayComponent: () => <ThemeDisplay theme={theme} />,
      onHighlight: () => previewTheme(theme.id),
      onHighlightEnd: clearThemePreview,
    });
  });

  registerHotkey({
    scopeId: 'global',
    description: () =>
      `${themeMode() === 'system' ? 'Turn off a' : 'A'}uto-detect color scheme`,
    keyDownHandler: () => {
      // Toggle system (auto-detect) on/off; turning it off pins the theme to the
      // OS's current scheme so the appearance doesn't visibly change.
      setThemeMode((prev) => (prev === 'system' ? systemMode() : 'system'));
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
