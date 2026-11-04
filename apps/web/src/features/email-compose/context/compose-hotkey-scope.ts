import { createContext, useContext } from 'solid-js';

/** The compose layout's hotkey scope, for keys its toolbar actions own. */
export const ComposeHotkeyScope = createContext<string>();

export function useComposeHotkeyScope(): string | undefined {
  return useContext(ComposeHotkeyScope);
}
