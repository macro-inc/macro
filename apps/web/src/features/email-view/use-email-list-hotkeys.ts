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
};

/**
 * The list-level shortcuts the legacy mail list had beyond navigation and
 * entity actions: `cmd+k` opens the command menu in entity-action mode for
 * the multi-selection (or toggles it when nothing is selected), and Escape
 * clears the selection.
 */
export function useEmailListHotkeys(options: UseEmailListHotkeysOptions) {
  const analytics = useAnalytics();
  const group = createHotkeyGroup();

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
  }).withGroup(group);

  onCleanup(() => group.dispose());
}
