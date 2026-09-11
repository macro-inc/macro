import { CommandState } from '@app/features/command';
import { ContextMenuContent, MenuItem } from '@core/component/ContextMenu';
import { TOKENS } from '@core/hotkey/tokens';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Dropdown } from '@ui';
import type { ComponentProps } from 'solid-js';

/** Shared discovery menu for the expanded sidebar and compact rail. */
export function SidebarSearchMenu(props: {
  onSearch: () => void;
  triggerProps?: ComponentProps<typeof Dropdown.Trigger>;
}) {
  let selectedAction: (() => void) | undefined;
  return (
    <Dropdown
      placement="right-start"
      onOpenChange={(open) => {
        if (open) selectedAction = undefined;
      }}
    >
      <Dropdown.Trigger {...props.triggerProps} label="Search">
        <MagnifyingGlassIcon />
      </Dropdown.Trigger>
      <DropdownMenu.Portal>
        <ContextMenuContent
          contentComponent={DropdownMenu.Content}
          class="z-tool-tip! min-w-56 text-xs text-ink-muted"
          // Open the destination after dismissal so the menu cannot steal its focus.
          onCloseAutoFocus={(event) => {
            if (!selectedAction) return;
            event.preventDefault();
            // Let Kobalte restore trigger focus before focusing the destination.
            queueMicrotask(selectedAction);
            selectedAction = undefined;
          }}
        >
          <MenuItem
            text="Command Menu"
            shortcut="cmd+k"
            onClick={() => {
              selectedAction = () => CommandState.open();
            }}
          />
          <MenuItem
            text="Search everything"
            hotkeyToken={TOKENS.sidebar.goTo.search}
            onClick={() => {
              selectedAction = props.onSearch;
            }}
          />
        </ContextMenuContent>
      </DropdownMenu.Portal>
    </Dropdown>
  );
}
