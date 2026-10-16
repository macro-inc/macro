import CaretDown from '@phosphor/caret-down.svg';
import { Dropdown, type DropdownContentProps } from '@ui/components/Dropdown';
import { For, type JSX, Show } from 'solid-js';
import { ChoiceChip } from './ChoiceChip';

/**
 * A list-validated cell's choices, opened from a button beside the active
 * cell as in Excel, or with Alt+Down. The list is a non-modal popover: it opens
 * below the cell, or above or beside it when there is no room, never over it,
 * and the sheet stays visible and usable around it.
 */
export function CellListMenu(props: {
  address: string;
  items: string[];
  /** Choice colors by lowercase text. */
  colors?: Map<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The active cell and its button, at the bottom right of this box. */
  style: JSX.CSSProperties;
  buttonSize: number;
  onPick: (item: string) => void;
  onRestoreFocus: () => void;
  /** Prevent the default to keep the list open through a press outside it. */
  onPointerDownOutside: DropdownContentProps['onPointerDownOutside'];
}) {
  let anchor!: HTMLDivElement;
  return (
    <div
      ref={anchor}
      class="pointer-events-none absolute z-[3]"
      style={props.style}
    >
      <div
        class="pointer-events-auto absolute right-0 bottom-0"
        style={{
          width: `${props.buttonSize}px`,
          height: `${props.buttonSize}px`,
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onDblClick={(event) => event.stopPropagation()}
      >
        <Dropdown
          open={props.open}
          onOpenChange={props.onOpenChange}
          getAnchorRect={() => anchor.getBoundingClientRect()}
          placement="bottom-start"
          flip="top-start right-start left-start"
          hideWhenDetached
          modal={false}
        >
          <Dropdown.Trigger
            variant="outline"
            size="icon-xs"
            label={`Choose a value for ${props.address}`}
            tabIndex={-1}
            class="size-full min-h-0 min-w-0 rounded-none p-0 touch:min-h-0 touch:min-w-0"
          >
            <CaretDown class="size-3" />
          </Dropdown.Trigger>
          <Dropdown.Content
            class="max-h-[min(18rem,var(--kb-popper-content-available-height))] min-w-[max(8rem,var(--kb-popper-anchor-width))] max-w-80 overflow-y-auto overscroll-contain text-xs backdrop-filter-none! touch:text-[max(14px,0.875rem)] touch:[&_[role=menuitem]]:min-h-[44px]"
            onPointerDownOutside={props.onPointerDownOutside}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // Kobalte returns focus to its trigger after this handler. It runs
              // a task after closing, when the list may already be open again
              // for another cell; focus then stays with that list.
              queueMicrotask(() => {
                if (!props.open) props.onRestoreFocus();
              });
            }}
          >
            <For each={props.items}>
              {(item) => (
                <Dropdown.Item
                  closeOnSelect
                  onSelect={() => props.onPick(item)}
                >
                  <Show
                    when={props.colors?.get(item.toLowerCase())}
                    fallback={<span class="truncate">{item}</span>}
                  >
                    {(color) => <ChoiceChip color={color()}>{item}</ChoiceChip>}
                  </Show>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Content>
        </Dropdown>
      </div>
    </div>
  );
}
