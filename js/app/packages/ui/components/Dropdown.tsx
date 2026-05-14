import { DropdownMenu as KobalteDropdownMenu } from '@kobalte/core/dropdown-menu';
import { Button, type ButtonProps } from './Button';
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
  SubContent: KobalteDropdownMenu.SubContent,           /* todo */
  SubTrigger: KobalteDropdownMenu.SubTrigger,           /* todo */
  ItemLabel: KobalteDropdownMenu.ItemLabel,             /* todo */
  RadioItem: KobalteDropdownMenu.RadioItem,             /* todo */
  Content: KobalteDropdownMenu.Content,                 /* todo */
  Portal: KobalteDropdownMenu.Portal,                   /* todo */
  Group: KobalteDropdownMenu.Group,                     /* todo */
  Item: KobalteDropdownMenu.Item,                       /* todo */
  Icon: KobalteDropdownMenu.Icon,                       /* todo */
  Sub: KobalteDropdownMenu.Sub,                         /* todo */
  Trigger: DropdownTrigger,
});
