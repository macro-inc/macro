import type { ListDetailNavigationTarget } from '@app/components/list';
import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { type Accessor, onCleanup } from 'solid-js';

export function useListNavigationHotkeys(options: {
  scopeId: string;
  enabled: Accessor<boolean>;
  navigation: ListDetailNavigationTarget;
}) {
  const group = createHotkeyGroup();

  registerHotkey({
    hotkey: 'j',
    hotkeyToken: TOKENS.entity.step.end,
    scopeId: options.scopeId,
    description: 'Next item',
    condition: () => options.enabled() && options.navigation.canNext(),
    keyDownHandler: () => {
      options.navigation.next();
      return true;
    },
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: 'k',
    hotkeyToken: TOKENS.entity.step.start,
    scopeId: options.scopeId,
    description: 'Previous item',
    condition: () => options.enabled() && options.navigation.canPrevious(),
    keyDownHandler: () => {
      options.navigation.previous();
      return true;
    },
    hide: true,
  }).withGroup(group);

  onCleanup(() => group.dispose());
}
