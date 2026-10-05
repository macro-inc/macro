/**
 * The canvas and layers context menu, opened at a point (the right-click)
 * with Figma's entries: labels left, shortcuts right-aligned, view toggles
 * checked. Presentational: entries and the action come in as props.
 */

import {
  ContextMenuContent,
  MENU_ITEM_CLASS,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import Check from '@phosphor/check.svg';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import {
  type MenuAction,
  type MenuEntry,
  shortcutLabel,
} from '../core/context-menu';

export function FigContextMenu(props: {
  /** Where the menu opens (client coordinates); closed when absent. */
  at: { x: number; y: number } | undefined;
  entries: MenuEntry[];
  mac: boolean;
  onSelect: (action: MenuAction) => void;
  onClose: () => void;
}) {
  const anyChecked = () =>
    props.entries.some((e) => e !== 'separator' && e.checked !== undefined);
  return (
    // A menu anchored at the pointer: Kobalte's context menu cannot be
    // opened from code, so this is its dropdown with the same surface.
    <DropdownMenu
      open={!!props.at}
      placement="bottom-start"
      gutter={2}
      // A tall menu slides over the pointer to stay on screen.
      overlap
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      getAnchorRect={() => ({
        x: props.at?.x ?? 0,
        y: props.at?.y ?? 0,
        width: 0,
        height: 0,
      })}
    >
      <DropdownMenu.Portal>
        <ContextMenuContent
          contentComponent={DropdownMenu.Content}
          class="w-60 text-xs"
          // The chosen action decides where focus goes (a rename field).
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {/* Portaled events bubble to where the menu sits (the canvas),
              which must not take presses on items as canvas presses. */}
          <div
            class="w-full"
            data-testid="fig-context-menu"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
          >
            <For each={props.entries}>
              {(entry) =>
                entry === 'separator' ? (
                  <MenuSeparator />
                ) : (
                  <DropdownMenu.Item
                    class={cn(MENU_ITEM_CLASS, 'gap-2 px-2 py-1 text-xs')}
                    disabled={entry.disabled}
                    data-testid={`fig-menu-${entry.action}`}
                    onSelect={() => props.onSelect(entry.action)}
                  >
                    <Show when={anyChecked()}>
                      <span class="flex w-3 shrink-0 justify-center">
                        <Show when={entry.checked}>
                          <Check class="size-3" />
                        </Show>
                      </span>
                    </Show>
                    <span class="flex-1 truncate">{entry.label}</span>
                    <Show when={entry.shortcut}>
                      {(keys) => (
                        <span class="shrink-0 pl-4 text-ink-muted tabular-nums">
                          {shortcutLabel(keys(), props.mac)}
                        </span>
                      )}
                    </Show>
                  </DropdownMenu.Item>
                )
              }
            </For>
          </div>
        </ContextMenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
