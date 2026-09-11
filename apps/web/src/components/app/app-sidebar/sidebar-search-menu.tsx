import { CommandState } from '@app/features/command';
import { TOKENS } from '@core/hotkey/tokens';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Dropdown, Hotkey } from '@ui';
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
      <Dropdown.Content
        class="min-w-64"
        // Open the destination after dismissal so the menu cannot steal its focus.
        onCloseAutoFocus={(event) => {
          if (!selectedAction) return;
          event.preventDefault();
          selectedAction();
          selectedAction = undefined;
        }}
      >
        <Dropdown.Item
          onSelect={() => {
            selectedAction = () => CommandState.open();
          }}
        >
          <span class="flex-1">Command Menu</span>
          <Hotkey shortcut="cmd+k" theme="subtle" class="ml-6" />
        </Dropdown.Item>
        <Dropdown.Item
          onSelect={() => {
            selectedAction = props.onSearch;
          }}
        >
          <span class="flex-1">Search everything</span>
          <Hotkey
            token={TOKENS.sidebar.goTo.search}
            theme="subtle"
            class="ml-6"
          />
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  );
}
