import { CommandState } from '@app/features/command/state';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { HotkeyTags } from '@core/hotkey/constants';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { EntityData } from '@entity';
import { onCleanup } from 'solid-js';
import type { EmailBulkSelection } from './primitives/bulk-selection';

export type UseEmailListHotkeysOptions = {
  scopeId: string;
  enabled: () => boolean;
  selectedEntities: () => EntityData[];
  clearSelection: () => void;
  focusedEntityId: () => string | undefined;
  bulk: EmailBulkSelection;
  viewLabel: () => string;
};

/**
 * The list-level shortcuts the legacy mail list had beyond navigation and
 * entity actions: `cmd+k` opens the command menu in entity-action mode for
 * the multi-selection (or toggles it when nothing is selected), and Escape
 * clears the selection. Bulk selections add "select all below" (Superhuman's
 * shift+cmd+down), "select all in this view", and their Done and Mark read.
 */
export function useEmailListHotkeys(options: UseEmailListHotkeysOptions) {
  const analytics = useAnalytics();
  const group = createHotkeyGroup();
  const { bulk } = options;
  const bulkReady = () => options.enabled() && bulk.state().status === 'ready';

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
    condition: () =>
      options.enabled() &&
      (options.selectedEntities().length > 0 || bulk.isActive()),
    keyDownHandler: () => {
      bulk.clear();
      options.clearSelection();
      return true;
    },
  }).withGroup(group);

  registerHotkey({
    scopeId: options.scopeId,
    hotkey: 'shift+cmd+arrowdown',
    hotkeyToken: TOKENS.email.selectAllBelow,
    description: 'Select all below',
    condition: () =>
      options.enabled() &&
      bulk.canSelect() &&
      options.focusedEntityId() !== undefined,
    keyDownHandler: () => {
      const anchorId = options.focusedEntityId();
      if (!anchorId) return false;
      options.clearSelection();
      void bulk.selectBelow(anchorId);
      return true;
    },
    displayPriority: 9,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  registerHotkey({
    scopeId: options.scopeId,
    hotkeyToken: TOKENS.email.selectAllInView,
    description: () => `Select all in ${options.viewLabel()}`,
    condition: () => options.enabled() && bulk.canSelect(),
    keyDownHandler: () => {
      options.clearSelection();
      void bulk.selectView();
      return true;
    },
    displayPriority: 9,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  // Entity actions stand down while a bulk selection is active, so these
  // share E and shift+U with them.
  registerHotkey({
    scopeId: options.scopeId,
    hotkey: 'e',
    description: 'Mark selected conversations done',
    condition: bulkReady,
    keyDownHandler: () => {
      void bulk.run('done');
      return true;
    },
    registrationType: 'add',
    displayPriority: 10,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  registerHotkey({
    scopeId: options.scopeId,
    hotkey: 'shift+u',
    description: 'Mark selected conversations read',
    condition: bulkReady,
    keyDownHandler: () => {
      void bulk.run('read');
      return true;
    },
    registrationType: 'add',
    displayPriority: 9,
    tags: [HotkeyTags.SelectionModification],
  }).withGroup(group);

  onCleanup(() => group.dispose());
}
