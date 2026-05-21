import type {
  GroupOption,
  GroupOptionId,
} from '@app/component/next-soup/soup-view/group-options';
import CheckIcon from '@phosphor/check.svg';
import StackSimpleIcon from '@phosphor/stack-simple.svg';
import { Dropdown, Tooltip } from '@ui';
import { type Component, For, Show } from 'solid-js';

interface GroupDropdownProps {
  value: () => GroupOptionId;
  onChange: (value: GroupOptionId) => void;
  options: GroupOption[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export const GroupDropdown: Component<GroupDropdownProps> = (props) => {
  return (
    <Dropdown
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-start"
    >
      <Tooltip label="Group">
        <Dropdown.Trigger depth={2} class="bg-surface">
          <StackSimpleIcon />
          <span>Group</span>
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content>
        <Dropdown.Group>
          <For each={props.options}>
            {(option) => (
              <Dropdown.Item onSelect={() => props.onChange(option.value)}>
                <span
                  class="flex-1 truncate"
                  classList={{
                    'text-ink font-medium': props.value() === option.value,
                    'text-ink-muted': props.value() !== option.value,
                  }}
                >
                  {option.label}
                </span>
                <span class="size-3.5 flex items-center justify-center shrink-0">
                  <Show when={props.value() === option.value}>
                    <CheckIcon class="size-3 text-accent" />
                  </Show>
                </span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};
