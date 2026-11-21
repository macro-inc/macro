import { toast } from '@core/component/Toast/Toast';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import { useMutationUndoContext } from '@queries/undo';
import { onCleanup } from 'solid-js';
import { DEFAULT_EMAIL_TAB, EMAIL_TABS, type EmailTab } from './constants';

export type UseEmailViewHotkeysOptions = {
  scopeId: string;
  enabled: () => boolean;
  tab: () => EmailTab;
  setTab: (tab: EmailTab) => void;
  /** The list is on screen and has the keyboard, not the reader or a thread. */
  listHasKeyboard: () => boolean;
  hasSelection: () => boolean;
  /** A search is on screen; Escape clears it before leaving the tab. */
  hasSearch: () => boolean;
};

/** Keys that work in Email's list, its reading pane and an open thread. */
export function useEmailViewHotkeys(options: UseEmailViewHotkeysOptions) {
  const undo = useMutationUndoContext();
  const group = createHotkeyGroup();

  registerHotkey({
    hotkey: 'escape',
    scopeId: options.scopeId,
    description: `Back to ${
      EMAIL_TABS.find((item) => item.id === DEFAULT_EMAIL_TAB)?.label
    }`,
    condition: () =>
      options.enabled() &&
      options.listHasKeyboard() &&
      !options.hasSelection() &&
      !options.hasSearch() &&
      options.tab() !== DEFAULT_EMAIL_TAB,
    keyDownHandler: () => {
      options.setTab(DEFAULT_EMAIL_TAB);
      return true;
    },
    registrationType: 'add',
  }).withGroup(group);

  registerHotkey({
    hotkey: 'z',
    scopeId: options.scopeId,
    description: 'Undo',
    condition: () => options.enabled() && undo.canUndo(),
    keyDownHandler: (e) => {
      // A held key would undo one action per repeat.
      if (e?.repeat) return true;
      fireAndForget(
        undo.undo({ onError: () => toast.failure('Failed to undo') }),
        'email-view-hotkeys'
      );
      return true;
    },
  }).withGroup(group);

  onCleanup(() => group.dispose());
}
