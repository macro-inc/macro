import { DropdownMenu as KobalteDropdownMenu } from '@kobalte/core/dropdown-menu';
import { Button, type ButtonProps } from './Button';
import { cn } from '../utils/classname';
import type { ComponentProps } from 'solid-js';

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

export type DropdownTriggerProps = ComponentProps<typeof KobalteDropdownMenu.Trigger> & ButtonProps;
type DropdownContentProps = ComponentProps<typeof KobalteDropdownMenu.Content>;
type DropdownSubContentProps = ComponentProps<typeof KobalteDropdownMenu.SubContent>;
type DropdownItemProps = ComponentProps<typeof KobalteDropdownMenu.Item>;

const DROPDOWN_CONTENT_CLASS = 'z-action-menu bg-surface rounded-xl ring-1 ring-edge shadow-[0_8px_24px_-16px_rgba(0,0,0,0.24),0_2px_8px_-6px_rgba(0,0,0,0.18)] p-1.5';
const DROPDOWN_ITEM_CLASS = 'rounded-md hover:bg-ink/3 focus:bg-ink/3 data-[highlighted]:bg-ink/3';

function DropdownContent(props: DropdownContentProps) {
  return <KobalteDropdownMenu.Content {...props} class={cn(DROPDOWN_CONTENT_CLASS, props.class)} />;
}

function DropdownSubContent(props: DropdownSubContentProps) {
  return <KobalteDropdownMenu.SubContent {...props} class={cn(DROPDOWN_CONTENT_CLASS, props.class)} />;
}

function DropdownItem(props: DropdownItemProps) {
  return <KobalteDropdownMenu.Item {...props} class={cn(props.class, DROPDOWN_ITEM_CLASS)} />;
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

export const Dropdown = Object.assign((props: ComponentProps<typeof KobalteDropdownMenu>) => (<KobalteDropdownMenu {...props} />), {
  ItemDescription: KobalteDropdownMenu.ItemDescription, /* todo */
  ItemIndicator: KobalteDropdownMenu.ItemIndicator,     /* todo */
  CheckboxItem: KobalteDropdownMenu.CheckboxItem,       /* todo */
  RadioGroup: KobalteDropdownMenu.RadioGroup,           /* todo */
  GroupLabel: KobalteDropdownMenu.GroupLabel,           /* todo */
  SubContent: DropdownSubContent,
  SubTrigger: KobalteDropdownMenu.SubTrigger,           /* todo */
  ItemLabel: KobalteDropdownMenu.ItemLabel,             /* todo */
  RadioItem: KobalteDropdownMenu.RadioItem,             /* todo */
  Content: DropdownContent,
  Portal: KobalteDropdownMenu.Portal,                   /* todo */
  Group: KobalteDropdownMenu.Group,                     /* todo */
  Item: DropdownItem,
  Icon: KobalteDropdownMenu.Icon,                       /* todo */
  Sub: KobalteDropdownMenu.Sub,                         /* todo */
  Trigger: DropdownTrigger,
});
