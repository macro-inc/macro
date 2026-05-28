import type {
  GroupOption,
  GroupOptionId,
} from '@app/component/next-soup/soup-view/group-options';
import StackSimpleIcon from '@phosphor/stack-simple.svg';
import { Dropdown, Tooltip } from '@ui';
import { type Component, For } from 'solid-js';
import { TypeIndicator } from './unified-filter-dropdown';

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
                <TypeIndicator active={props.value() === option.value} />
                <span
                  class="flex-1 truncate"
                  classList={{
                    'text-ink font-medium': props.value() === option.value,
                    'text-ink-muted': props.value() !== option.value,
                  }}
                >
                  {option.label}
                </span>
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};
