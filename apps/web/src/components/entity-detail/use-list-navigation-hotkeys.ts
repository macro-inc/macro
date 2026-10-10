import type { ListDetailNavigationTarget } from '@app/components/list';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { type Accessor, onCleanup } from 'solid-js';

export function useListNavigationHotkeys(options: {
  scopeId: string;
  enabled: Accessor<boolean>;
  navigation: ListDetailNavigationTarget;
  arrowKeys?: boolean;
  /** Called with the keydown that stepped the list, before navigating. */
  onKeyStep?: (event: KeyboardEvent) => void;
}) {
  const group = createHotkeyGroup();
  const step = (move: () => void, event?: KeyboardEvent) => {
    if (event?.type === 'keydown') options.onKeyStep?.(event);
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

  onCleanup(() => group.dispose());
}
