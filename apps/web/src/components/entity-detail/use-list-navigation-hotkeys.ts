import type { ListDetailNavigationTarget } from '@app/components/list';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { makeEventListener } from '@solid-primitives/event-listener';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

/** Returns whether a navigation key that stepped the list is still held down. */
export function useListNavigationHotkeys(options: {
  scopeId: string;
  enabled: Accessor<boolean>;
  navigation: ListDetailNavigationTarget;
  arrowKeys?: boolean;
}): { held: Accessor<boolean> } {
  const group = createHotkeyGroup();
  const [heldKey, setHeldKey] = createSignal<string>();
  const step = (move: () => void, event?: KeyboardEvent) => {
    if (event?.type === 'keydown') setHeldKey(event.key.toLowerCase());
    move();
    return true;
  };

  registerHotkey({
    hotkey: options.arrowKeys ? ['j', 'arrowright'] : 'j',
    hotkeyToken: TOKENS.entity.step.end,
    scopeId: options.scopeId,
    description: 'Next item',
    condition: () => options.enabled() && options.navigation.canNext(),
    keyDownHandler: (event) => step(options.navigation.next, event),
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: options.arrowKeys ? ['k', 'arrowleft'] : 'k',
    hotkeyToken: TOKENS.entity.step.start,
    scopeId: options.scopeId,
    description: 'Previous item',
    condition: () => options.enabled() && options.navigation.canPrevious(),
    keyDownHandler: (event) => step(options.navigation.previous, event),
    hide: true,
  }).withGroup(group);

  // Capture phase: handlers that stop propagation must not strand the hold.
  makeEventListener(
    window,
    'keyup',
    (event) => {
      if (event.key.toLowerCase() === heldKey()) setHeldKey(undefined);
    },
    true
  );
  makeEventListener(window, 'blur', () => setHeldKey(undefined));

  onCleanup(() => group.dispose());

  return { held: () => heldKey() !== undefined };
}
