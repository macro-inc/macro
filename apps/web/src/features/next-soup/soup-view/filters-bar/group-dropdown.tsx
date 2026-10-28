import type {
  GroupOption,
  GroupOptionId,
} from '@app/features/next-soup/soup-view/group-options';
import StackSimpleIcon from '@icon/system/regular/stack-simple.svg';
import {
  Button,
  ButtonGroup,
  type ButtonVariant,
  Dropdown,
  SingleSelectCheck,
  Tooltip,
} from '@ui';
import { type Component, For, Show } from 'solid-js';

interface GroupDropdownProps {
  grouped?: boolean;
  value: () => GroupOptionId;
  onChange: (value: GroupOptionId) => void;
  options: GroupOption[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideLabel?: boolean;
  variant?: ButtonVariant;
}

export const GroupDropdown: Component<GroupDropdownProps> = (props) => {
  const triggerSize = () => {
    if (!props.hideLabel) return 'sm';
    return props.grouped ? 'icon-sm' : 'icon-md';
  };
  return (
    <Dropdown
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement="bottom-start"
    >
      <Tooltip label="Group">
        <Dropdown.Trigger
          as={props.grouped ? ButtonGroup.Button : Button}
          variant={props.variant ?? 'secondary'}
          size={triggerSize()}
          aria-label={props.hideLabel ? 'Group' : undefined}
        >
          <StackSimpleIcon class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          <Show when={!props.hideLabel}>
            <span>Group</span>
          </Show>
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Content>
        <Dropdown.Group>
          <For each={props.options}>
            {(option) => (
              <Dropdown.Item onSelect={() => props.onChange(option.value)}>
                <span class="flex-1 truncate">{option.label}</span>
                <SingleSelectCheck active={props.value() === option.value} />
              </Dropdown.Item>
            )}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
};
