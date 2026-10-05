import CaretDown from '@phosphor/caret-down.svg';
import { Dropdown } from '@ui/components/Dropdown';
import { For, type JSX } from 'solid-js';

/**
 * A list-validated cell's choices, opened from a button beside the active
 * cell as in Excel, or with Alt+Down.
 */
export function CellListMenu(props: {
  address: string;
  items: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  style: JSX.CSSProperties;
  onPick: (item: string) => void;
  onRestoreFocus: () => void;
}) {
  return (
    <div
      class="absolute z-[3]"
      style={props.style}
      onPointerDown={(event) => event.stopPropagation()}
      onDblClick={(event) => event.stopPropagation()}
    >
      <Dropdown
        open={props.open}
        onOpenChange={props.onOpenChange}
        placement="bottom-end"
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
          class="max-h-[min(18rem,60dvh)] min-w-32 max-w-80 overflow-y-auto overscroll-contain text-xs touch:text-[max(14px,0.875rem)] touch:[&_[role=menuitem]]:min-h-[44px]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Kobalte returns focus to its trigger after this handler.
            queueMicrotask(props.onRestoreFocus);
          }}
        >
          <For each={props.items}>
            {(item) => (
              <Dropdown.Item closeOnSelect onSelect={() => props.onPick(item)}>
                <span class="truncate">{item}</span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Content>
      </Dropdown>
    </div>
  );
}
