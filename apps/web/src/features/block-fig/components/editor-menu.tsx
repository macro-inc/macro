/** Shared accessible menu surface for the editor's tool and view menus. */
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import CaretRight from '@phosphor/caret-right.svg';
import Check from '@phosphor/check.svg';
import { For, type JSX, Show } from 'solid-js';

export interface EditorMenuItem {
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  icon?: JSX.Element;
  onSelect: () => void;
  testId?: string;
}

export interface EditorMenuGroup {
  label: string;
  testId?: string;
  items: (EditorMenuItem | 'divider')[];
}

export type EditorMenuEntry = EditorMenuItem | EditorMenuGroup | 'divider';

function MenuItem(props: { item: EditorMenuItem | 'divider' }) {
  const item = props.item;
  return item === 'divider' ? (
    <DropdownMenu.Separator class="my-1 h-px bg-edge-muted" />
  ) : (
    <DropdownMenu.Item
      disabled={item.disabled}
      data-testid={item.testId}
      class="flex h-6 items-center gap-2 rounded-md px-2 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-contrast"
      onSelect={item.onSelect}
    >
      <span class="flex size-4 shrink-0 items-center justify-center">
        <Show when={item.checked} fallback={item.icon}>
          <Check class="size-3.5" />
        </Show>
      </span>
      <span class="flex-1">{item.label}</span>
      <Show when={item.shortcut}>
        <span class="pl-5 opacity-70">{item.shortcut}</span>
      </Show>
    </DropdownMenu.Item>
  );
}

export function EditorMenu(props: {
  label: string;
  testId?: string;
  children: JSX.Element;
  items: EditorMenuEntry[];
  above?: boolean;
}) {
  return (
    <DropdownMenu
      placement={props.above ? 'top-start' : 'bottom-end'}
      gutter={8}
    >
      <DropdownMenu.Trigger
        aria-label={props.label}
        title={props.label}
        data-testid={props.testId}
        class="flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent data-[expanded]:bg-hover"
      >
        {props.children}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          class="fig-editor-theme z-modal min-w-52 rounded-xl border border-edge-muted bg-menu p-1 text-ink text-xs shadow-lg outline-none"
          classList={{
            // A submenu trigger must not live in a scroll container: Kobalte's
            // trigger focus helper loops on that ancestor with overflow-hidden pages.
            'max-h-[min(70vh,32rem)] overflow-y-auto': !props.items.some(
              (item) => item !== 'divider' && 'items' in item
            ),
          }}
          onKeyDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
        >
          <For each={props.items}>
            {(item) =>
              item !== 'divider' && 'items' in item ? (
                <DropdownMenu.Sub gutter={4}>
                  <DropdownMenu.SubTrigger
                    data-testid={item.testId}
                    class="flex h-6 items-center justify-between gap-6 rounded-md pr-2 pl-8 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-contrast data-[expanded]:bg-hover"
                  >
                    {item.label}
                    <CaretRight class="size-3.5" />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent
                      class="fig-editor-theme z-modal max-h-[min(70vh,32rem)] min-w-52 overflow-y-auto rounded-xl border border-edge-muted bg-menu p-1 text-ink text-xs shadow-lg outline-none"
                      onKeyDown={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onPointerUp={(e) => e.stopPropagation()}
                    >
                      <For each={item.items}>
                        {(entry) => <MenuItem item={entry} />}
                      </For>
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              ) : (
                <MenuItem item={item} />
              )
            }
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
