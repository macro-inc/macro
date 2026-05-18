import type {
  GroupOption,
  GroupOptionId,
} from '@app/component/next-soup/soup-view/group-options';
import CheckIcon from '@icon/check.svg';
import StackSimpleIcon from '@icon/stack-simple.svg';
import { Dropdown, Layer, Tooltip } from '@ui';
import { type Component, For, Show } from 'solid-js';

export interface GroupDropdownProps {
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
      gutter={4}
    >
      <Tooltip label="Group">
        <Dropdown.Trigger depth={2} class="bg-surface">
          <StackSimpleIcon />
          <span>Group</span>
        </Dropdown.Trigger>
      </Tooltip>
      <Dropdown.Portal>
        <Layer depth={2}>
          <Dropdown.Content class="z-action-menu bg-surface border border-edge-muted rounded-sm shadow-sm min-w-35 p-1">
            <For each={props.options}>
              {(option) => (
                <Dropdown.Item
                  class="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-ink/5 focus:bg-ink/5 outline-none cursor-default rounded-md"
                  onSelect={() => props.onChange(option.value)}
                >
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
          </Dropdown.Content>
        </Layer>
      </Dropdown.Portal>
    </Dropdown>
  );
};
