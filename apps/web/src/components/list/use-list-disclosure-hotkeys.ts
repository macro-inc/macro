import { createHotkeyGroup, registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import type { Accessor } from 'solid-js';
import { onCleanup } from 'solid-js';
import type { ListController } from './create-list-controller';
import type { ListScrollHandle } from './use-list-interactions';
import type { ListKey } from './types';

export type ListHotkeyDisclosure<TItem> = {
  getKey: (item: TItem) => string | undefined;
  isExpanded: (key: string) => boolean;
  setExpanded: (key: string, expanded: boolean) => void;
  getFocusKey?: (key: string, item: TItem) => ListKey | undefined;
};

export type UseListDisclosureHotkeysOptions<TItem, TMetadata> = {
  controller: ListController<TItem, TMetadata>;
  scopeId: string;
  scrollHandle: Accessor<ListScrollHandle | undefined>;
  disclosure: ListHotkeyDisclosure<TItem>;
  enabled?: () => boolean;
};

/** Registers parent/child keys for grouped or otherwise collapsible rows. */
export function useListDisclosureHotkeys<TItem, TMetadata = unknown>(
  options: UseListDisclosureHotkeysOptions<TItem, TMetadata>
) {
  const group = createHotkeyGroup();
  const list = options.controller;
  const isEnabled = () => options.enabled?.() ?? true;

  const setExpanded = (expanded: boolean) => {
    const item = list.focus.item();
    if (!item) return false;

    const key = options.disclosure.getKey(item);
    if (!key || options.disclosure.isExpanded(key) === expanded) return false;

    options.disclosure.setExpanded(key, expanded);
    if (expanded) return true;

    const focusKey = options.disclosure.getFocusKey?.(key, item);
    if (focusKey === undefined) return true;

    list.focus.set(focusKey, { reason: 'keyboard' });
    const index = list.focus.index();
    if (index >= 0) {
      options.scrollHandle()?.scrollToIndex(index, { align: 'nearest' });
    }
    return true;
  };

  registerHotkey({
    hotkey: ['h', 'arrowleft'],
    hotkeyToken: TOKENS.unifiedList.navigation.parent,
    scopeId: options.scopeId,
    description: 'Collapse item',
    condition: isEnabled,
    keyDownHandler: () => setExpanded(false),
    registrationType: 'add',
    handlerPriority: 4,
    hide: true,
  }).withGroup(group);

  registerHotkey({
    hotkey: ['l', 'arrowright'],
    hotkeyToken: TOKENS.unifiedList.navigation.child,
    scopeId: options.scopeId,
    description: 'Expand item',
    condition: isEnabled,
    keyDownHandler: () => setExpanded(true),
    registrationType: 'add',
    handlerPriority: 4,
    hide: true,
  }).withGroup(group);

  onCleanup(() => group.dispose());
}
