import { GO_TO_COMMAND_SCOPE, GO_TO_LEADER_KEY } from '@app/constants/hotkeys';
import { CommandState } from '@app/features/command/state';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import { onCleanup } from 'solid-js';

export type UseEmailListHotkeysOptions = {
  scopeId: string;
  enabled: () => boolean;
  selectedEntities: () => EntityData[];
  clearSelection: () => void;
  /** The reading pane beside the list has the keyboard. */
  readerHasKeyboard: () => boolean;
  goToFirst: () => boolean;
};

/**
 * The list-level shortcuts the legacy mail list had beyond navigation and
 * entity actions: `cmd+k` opens the command menu in entity-action mode for
 * the multi-selection (or toggles it when nothing is selected), Escape
 * clears the selection, and `g g` reaches the first email from the reading
 * pane as it does from the list.
 */
export function useEmailListHotkeys(options: UseEmailListHotkeysOptions) {
  const analytics = useAnalytics();
  const group = createHotkeyGroup();

  // The reader steps through the list with j and k, so the list's own g g
  // (which stands down while the reader has the keyboard) is mirrored here.
  // Unhandled, the second g would restart the sidebar's go-to leader.
  registerHotkey({
    hotkey: GO_TO_LEADER_KEY,
    scopeId: GO_TO_COMMAND_SCOPE,
    description: 'Go to first email',
    condition: options.readerHasKeyboard,
    keyDownHandler: options.goToFirst,
    registrationType: 'add',
  }).withGroup(group);

  registerHotkey({
    scopeId: options.scopeId,
    hotkey: 'cmd+k',
    hotkeyToken: TOKENS.global.commandMenu,
    description: () =>
      CommandState.isOpen() ? 'Close command menu' : 'Open command menu',
    condition: () => options.enabled() && !CommandState.isOpen(),
    keyDownHandler: (event) => {
      event?.preventDefault();
      const selected = options.selectedEntities();

      if (selected.length > 0) {
        analytics.track('command_menu_open', {
          from: 'email_view_entity_action',
        });
        CommandState.openForEntityAction([...selected]);
      } else {
        analytics.track('command_menu_open', { from: 'email_view' });
        CommandState.toggle();
      }

      return true;
    },
    displayPriority: 10,
    hide: CommandState.isOpen,
    runWithInputFocused: true,
  }).withGroup(group);

  registerHotkey({
    scopeId: options.scopeId,
    hotkey: 'escape',
    hotkeyToken: TOKENS.soup.dismiss,
    description: 'Clear selection',
    condition: () => options.enabled() && options.selectedEntities().length > 0,
    keyDownHandler: () => {
      options.clearSelection();
      return true;
    },
    // Without a selection, Escape returns the view to Signal (email-view).
    registrationType: 'add',
  }).withGroup(group);

  onCleanup(() => group.dispose());
}
