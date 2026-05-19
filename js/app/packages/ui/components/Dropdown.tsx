import { DropdownMenu as KobalteDropdownMenu } from '@kobalte/core/dropdown-menu';
import { Button, type ButtonProps } from './Button';
import { Surface, type SurfaceProps } from './Surface';
import { cn } from '../utils/classname';
import { splitProps, type ComponentProps } from 'solid-js';

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


export type DropdownSubContentProps = ComponentProps<typeof KobalteDropdownMenu.SubContent> & { depth?: SurfaceProps['depth']; };
export type DropdownContentProps = ComponentProps<typeof KobalteDropdownMenu.Content> & { depth?: SurfaceProps['depth']; };
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

function DropdownContent(props: DropdownContentProps) {
  const [local, rest] = splitProps(props, ['depth', 'class']);
  return (
    <KobalteDropdownMenu.Content
      class={cn('size-auto z-action-menu min-w-40 p-1', local.class)}
      depth={local.depth ?? 2}
      as={Surface}
      {...rest}
    />
  );
}

function DropdownSubContent(props: DropdownSubContentProps) {
  const [local, rest] = splitProps(props, ['depth', 'class']);
  return (
    <KobalteDropdownMenu.SubContent
      class={cn('size-auto z-action-menu min-w-40 p-1', local.class)}
      depth={local.depth ?? 2}
      as={Surface}
      {...rest}
    />
  );
}

export const Dropdown = Object.assign((props: ComponentProps<typeof KobalteDropdownMenu>) => (<KobalteDropdownMenu {...props} />), {
  ItemDescription: KobalteDropdownMenu.ItemDescription, /* todo */
  ItemIndicator: KobalteDropdownMenu.ItemIndicator,     /* todo */
  CheckboxItem: KobalteDropdownMenu.CheckboxItem,       /* todo */
  RadioGroup: KobalteDropdownMenu.RadioGroup,           /* todo */
  GroupLabel: KobalteDropdownMenu.GroupLabel,           /* todo */
  SubTrigger: KobalteDropdownMenu.SubTrigger,           /* todo */
  ItemLabel: KobalteDropdownMenu.ItemLabel,             /* todo */
  RadioItem: KobalteDropdownMenu.RadioItem,             /* todo */
  Portal: KobalteDropdownMenu.Portal,                   /* todo */
  Group: KobalteDropdownMenu.Group,                     /* todo */
  Item: KobalteDropdownMenu.Item,                       /* todo */
  Icon: KobalteDropdownMenu.Icon,                       /* todo */
  Sub: KobalteDropdownMenu.Sub,                         /* todo */

  SubContent: DropdownSubContent,
  Content: DropdownContent,
  Trigger: DropdownTrigger,
});
