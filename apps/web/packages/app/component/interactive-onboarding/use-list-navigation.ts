import type { SoupState } from '@app/component/next-soup/create-soup-state';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { onCleanup, onMount } from 'solid-js';

/**
 * Registers J / ↓ and K / ↑ navigation hotkeys into the given scope for the
 * provided soup state. Call this in any component that renders a navigable list
 * so keyboard navigation is always available while the list is visible.
 *
 * @param soup      The soup state to navigate
 * @param scopeId   The hotkey scope to register into (use the shell's scopeId)
 * @param onNavigate  Optional callback fired after each navigation step
 */
export function useListNavigation(
  soup: SoupState,
  scopeId: string,
  onNavigate?: (direction: 'down' | 'up') => void
) {
  const group = createHotkeyGroup();

  onMount(() => {
    const handle = (direction: 'down' | 'up') => {
      soup.navigate[direction]();
      onNavigate?.(direction);
      return true;
    };

    registerHotkey({
      scopeId,
      hotkey: ['j', 'arrowdown'],
      description: 'Navigate down',
      keyDownHandler: () => handle('down'),
    }).withGroup(group);

    registerHotkey({
      scopeId,
      hotkey: ['k', 'arrowup'],
      description: 'Navigate up',
      keyDownHandler: () => handle('up'),
    }).withGroup(group);
  });

  onCleanup(() => group.dispose());
}
