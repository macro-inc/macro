import { GO_TO_COMMAND_SCOPE } from '@app/constants/hotkeys';
import { toast } from '@core/component/Toast/Toast';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { HOTKEY_PRIORITY_HIGH, type ValidHotkey } from '@core/hotkey/types';
import { isScopeInActiveBranch } from '@core/hotkey/utils';
import { useMutationUndoContext } from '@queries/undo';
import { onCleanup } from 'solid-js';
import { DEFAULT_EMAIL_TAB, EMAIL_TABS, type EmailTab } from './constants';

/**
 * Mail-client "go to" keys (g then i for Signal, as in other mail clients).
 * While Email is focused they take the letters' app-wide meanings; elsewhere
 * the letters keep them (g t is still Tasks).
 */
const EMAIL_GO_TO_TABS = [
  ['i', 'important'],
  ['o', 'noise'],
  ['s', 'favorites'],
  ['t', 'sent'],
  ['d', 'drafts'],
  ['e', 'archived'],
  ['h', 'reminders'],
  ['a', 'all'],
] as const satisfies readonly (readonly [ValidHotkey, EmailTab])[];

export type UseEmailViewHotkeysOptions = {
  scopeId: string;
  enabled: () => boolean;
  tab: () => EmailTab;
  setTab: (tab: EmailTab) => void;
  isTabAvailable: (tab: EmailTab) => boolean;
  threadOpen: () => boolean;
  hasSelection: () => boolean;
  compose: () => void;
  readingPane: () => boolean;
  setReadingPane: (enabled: boolean) => void;
};

/** Keys that work in Email's list and its open thread alike. */
export function useEmailViewHotkeys(options: UseEmailViewHotkeysOptions) {
  const undo = useMutationUndoContext();
  const group = createHotkeyGroup();

  for (const [key, tab] of EMAIL_GO_TO_TABS) {
    const label = EMAIL_TABS.find((item) => item.id === tab)?.label ?? tab;
    registerHotkey({
      hotkey: key,
      scopeId: GO_TO_COMMAND_SCOPE,
      description: `Go to ${label}`,
      // `g` re-parents the go-to scope onto the scope it was pressed in.
      condition: () =>
        options.enabled() &&
        isScopeInActiveBranch(options.scopeId) &&
        options.isTabAvailable(tab),
      keyDownHandler: () => {
        options.setTab(tab);
        return true;
      },
      // Coexist with, and run before, the app-wide letters.
      registrationType: 'add',
      handlerPriority: HOTKEY_PRIORITY_HIGH,
    }).withGroup(group);
  }

  registerHotkey({
    hotkey: 'escape',
    scopeId: options.scopeId,
    description: `Back to ${
      EMAIL_TABS.find((item) => item.id === DEFAULT_EMAIL_TAB)?.label
    }`,
    condition: () =>
      options.enabled() &&
      !options.threadOpen() &&
      !options.hasSelection() &&
      options.tab() !== DEFAULT_EMAIL_TAB,
    keyDownHandler: () => {
      options.setTab(DEFAULT_EMAIL_TAB);
      return true;
    },
    registrationType: 'add',
  }).withGroup(group);

  registerHotkey({
    hotkey: 'c',
    hotkeyToken: TOKENS.email.compose.new,
    scopeId: options.scopeId,
    description: 'New email',
    condition: options.enabled,
    keyDownHandler: () => {
      options.compose();
      return true;
    },
    displayPriority: 10,
  }).withGroup(group);

  registerHotkey({
    hotkey: 'shift+v',
    hotkeyToken: TOKENS.email.toggleReadingPane,
    scopeId: options.scopeId,
    description: () =>
      options.readingPane() ? 'Hide reading pane' : 'Show reading pane',
    condition: options.enabled,
    keyDownHandler: () => {
      options.setReadingPane(!options.readingPane());
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    hotkey: 'z',
    scopeId: options.scopeId,
    description: 'Undo',
    condition: () => options.enabled() && undo.canUndo(),
    keyDownHandler: () => {
      void undo.undo({ onError: () => toast.failure('Failed to undo') });
      return true;
    },
  }).withGroup(group);

  onCleanup(() => group.dispose());
}
