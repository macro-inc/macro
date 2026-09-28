import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { onCleanup } from 'solid-js';

export type UseViewTabHotkeysOptions<TTab extends string> = {
  scopeId: string;
  ids: () => readonly TTab[];
  activeId: () => TTab;
  setActiveId: (id: TTab) => void;
  enabled?: () => boolean;
};

/** Registers numeric and sequential navigation for a view's tabs. */
export function useViewTabHotkeys<TTab extends string>(
  options: UseViewTabHotkeysOptions<TTab>
) {
  const group = createHotkeyGroup();
  const isEnabled = () => options.enabled?.() ?? true;
  const numberKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

  numberKeys.forEach((key, index) => {
    registerHotkey({
      hotkey: key,
      hotkeyToken: TOKENS.soup.tabs[key],
      scopeId: options.scopeId,
      description: `Switch to tab ${key}`,
      condition: () => isEnabled() && options.ids().length > index,
      keyDownHandler: () => {
        const id = options.ids()[index];
        if (!id) return false;

        options.setActiveId(id);
        return true;
      },
      hide: true,
    }).withGroup(group);
  });

  const move = (offset: 1 | -1) => {
    const ids = options.ids();
    if (ids.length < 2) return false;

    const currentIndex = ids.indexOf(options.activeId());
    let origin = currentIndex;
    if (origin === -1) {
      origin = offset === 1 ? -1 : 0;
    }

    const nextIndex = (origin + offset + ids.length) % ids.length;
    const next = ids[nextIndex];
    if (!next) return false;

    options.setActiveId(next);
    return true;
  };

  registerHotkey({
    hotkey: 'tab',
    hotkeyToken: TOKENS.soup.tabs.next,
    scopeId: options.scopeId,
    description: 'Next tab',
    condition: () => isEnabled() && options.ids().length > 1,
    keyDownHandler: () => move(1),
  }).withGroup(group);

  registerHotkey({
    hotkey: 'shift+tab',
    hotkeyToken: TOKENS.soup.tabs.prev,
    scopeId: options.scopeId,
    description: 'Previous tab',
    condition: () => isEnabled() && options.ids().length > 1,
    keyDownHandler: () => move(-1),
  }).withGroup(group);

  onCleanup(() => group.dispose());
}
