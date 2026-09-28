import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { onCleanup } from 'solid-js';

export type ViewControlHotkeyAction = {
  description: string;
  run: () => boolean | void;
  condition?: () => boolean;
};

export type UseViewControlHotkeysOptions = {
  scopeId: string;
  enabled?: () => boolean;
  search?: ViewControlHotkeyAction;
  filter?: ViewControlHotkeyAction;
  sort?: ViewControlHotkeyAction;
};

/** Registers shortcuts that open a view's search, filter, and sort controls. */
export function useViewControlHotkeys(options: UseViewControlHotkeysOptions) {
  const group = createHotkeyGroup();
  const isEnabled = () => options.enabled?.() ?? true;

  const registerAction = (
    hotkey: ValidHotkey,
    hotkeyToken: HotkeyToken,
    action: ViewControlHotkeyAction | undefined,
    registrationType: 'add' | 'override' = 'override'
  ) => {
    if (!action) return;

    registerHotkey({
      hotkey,
      hotkeyToken,
      scopeId: options.scopeId,
      description: action.description,
      condition: () => isEnabled() && (action.condition?.() ?? true),
      keyDownHandler: () => action.run() !== false,
      registrationType,
      runWithInputFocused: hotkey === 'cmd+f',
    }).withGroup(group);
  };

  registerAction('cmd+f', TOKENS.soup.openSearch, options.search, 'add');
  registerAction('f', TOKENS.soup.filter, options.filter);
  registerAction('s', TOKENS.soup.sort, options.sort);

  onCleanup(() => group.dispose());
}
