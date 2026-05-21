import { DropdownMenu as KobalteDropdownMenu } from '@kobalte/core/dropdown-menu';
import CheckIcon from '@phosphor/check.svg';
import { type ComponentProps, Show, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';

/*
<Dropdown>
  <Dropdown.Trigger>Filter</Dropdown.Trigger>
  <Dropdown.Portal>
    <Dropdown.Content>
      <Dropdown.Item></Dropdown.Item>
    </Dropdown.Content>
  </Dropdown.Portal>
</Dropdown>
*/

type DropdownTriggerProps = ComponentProps<typeof KobalteDropdownMenu.Trigger> & ButtonProps;
type DropdownContentProps = ComponentProps<typeof KobalteDropdownMenu.Content>;
type DropdownSubContentProps = ComponentProps<typeof KobalteDropdownMenu.SubContent>;
type DropdownItemProps = ComponentProps<typeof KobalteDropdownMenu.Item>;
type DropdownSeparatorProps = ComponentProps<typeof KobalteDropdownMenu.Separator>;
type DropdownIndicatorProps = ComponentProps<'div'> & { checked: boolean };

function DropdownContent(props: DropdownContentProps) {
  return (
    <KobalteDropdownMenu.Content
      {...props}
      class={cn(
        'z-action-menu bg-surface rounded-xl ring-1 ring-edge shadow-[0_8px_24px_-16px_rgba(0,0,0,0.24),0_2px_8px_-6px_rgba(0,0,0,0.18)] p-1.5',
        props.class
      )}
    />
  );
}

function DropdownSubContent(props: DropdownSubContentProps) {
  return (
    <KobalteDropdownMenu.SubContent
      {...props}
      class={cn(
        'z-action-menu bg-surface rounded-xl ring-1 ring-edge shadow-[0_8px_24px_-16px_rgba(0,0,0,0.24),0_2px_8px_-6px_rgba(0,0,0,0.18)] p-1.5',
        props.class
      )}
    />
  );
}

function DropdownItem(props: DropdownItemProps) {
  return (
    <KobalteDropdownMenu.Item
      {...props}
      class={cn('rounded-md hover:bg-hover/50 focus:bg-hover/50 data-highlighted:bg-hover/50', props.class)}
    />
  );
}

function DropdownSeparator(props: DropdownSeparatorProps) {
  return (
    <KobalteDropdownMenu.Separator
      {...props}
      class={cn('h-px bg-edge-muted border-0 -mx-1.5 my-1', props.class)}
    />
  );
}

function DropdownTrigger(props: DropdownTriggerProps) {
  return (
    <KobalteDropdownMenu.Trigger
      variant="base"
      as={Button}
      {...props}
      size="sm"
    />
  );
}

function DropdownSingleSelectIndicator(props: DropdownIndicatorProps) {
  const [local, others] = splitProps(props, ['class', 'checked']);
  return (
    <div
      {...others}
      class={cn(
        'size-4 rounded-full border flex items-center justify-center',
        local.checked ? 'bg-accent border-accent' : 'bg-transparent border-edge-muted',
        local.class
      )}
    />
  );
}

function DropdownMultiSelectIndicator(props: DropdownIndicatorProps) {
  const [local, others] = splitProps(props, ['class', 'checked']);
  return (
    <div
      {...others}
      class={cn(
        'size-4 rounded-sm border flex items-center justify-center',
        local.checked ? 'bg-accent border-accent' : 'bg-transparent border-edge-muted',
        local.class
      )}
    >
      <Show when={local.checked}>
        <CheckIcon class="size-3 text-surface" />
      </Show>
    </div>
  );
}

export const Dropdown = Object.assign((props: ComponentProps<typeof KobalteDropdownMenu>) => (<KobalteDropdownMenu {...props} />), {
  ItemDescription: KobalteDropdownMenu.ItemDescription,
  ItemIndicator: KobalteDropdownMenu.ItemIndicator,
  CheckboxItem: KobalteDropdownMenu.CheckboxItem,
  RadioGroup: KobalteDropdownMenu.RadioGroup,
  GroupLabel: KobalteDropdownMenu.GroupLabel,
  SubContent: DropdownSubContent,
  SubTrigger: KobalteDropdownMenu.SubTrigger,
  ItemLabel: KobalteDropdownMenu.ItemLabel,
  RadioItem: KobalteDropdownMenu.RadioItem,
  Content: DropdownContent,
  Portal: KobalteDropdownMenu.Portal,
  Group: KobalteDropdownMenu.Group,
  Item: DropdownItem,
  Separator: DropdownSeparator,
  Icon: KobalteDropdownMenu.Icon,
  Sub: KobalteDropdownMenu.Sub,
  Trigger: DropdownTrigger,
  SingleSelectIndicator: DropdownSingleSelectIndicator,
  MultiSelectIndicator: DropdownMultiSelectIndicator,
});
