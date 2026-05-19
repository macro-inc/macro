import { DropdownMenu as KobalteDropdownMenu } from '@kobalte/core/dropdown-menu';
import { Button, type ButtonProps } from './Button';
import { Surface, type SurfaceProps } from './Surface';
import { cn } from '../utils/classname';
import { splitProps, type ComponentProps } from 'solid-js';

/*
<Dropdown>
  <Dropdown.Trigger>Filter</Dropdown.Trigger>
  <Dropdown.Content>
    <Dropdown.Group>
      <Dropdown.Item></Dropdown.Item>
    </Dropdown.Group>
  </Dropdown.Content>
</Dropdown>

Content and SubContent portal to <body> automatically. Pass `mount` to
relocate to a scoped container (e.g. a per-block <ScopedPortal> mount node)
when you want the menu to inherit a different stacking/focus context.
*/

type PortalMount = ComponentProps<typeof KobalteDropdownMenu.Portal>['mount'];

export type DropdownSubContentProps = ComponentProps<typeof KobalteDropdownMenu.SubContent> & { depth?: SurfaceProps['depth']; mount?: PortalMount; };
export type DropdownContentProps = ComponentProps<typeof KobalteDropdownMenu.Content> & { depth?: SurfaceProps['depth']; mount?: PortalMount; };
export type DropdownTriggerProps = ComponentProps<typeof KobalteDropdownMenu.Trigger> & ButtonProps;
export type DropdownGroupProps = ComponentProps<typeof KobalteDropdownMenu.Group>;

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
  const [local, rest] = splitProps(props, ['depth', 'class', 'mount']);
  return (
    <KobalteDropdownMenu.Portal mount={local.mount}>
      <KobalteDropdownMenu.Content
        class={cn('flex flex-col size-auto z-action-menu gap-1 bg-[var(--b3)]', local.class)}
        depth={local.depth ?? 2}
        as={Surface}
        {...rest}
      />
    </KobalteDropdownMenu.Portal>
  );
}

function DropdownSubContent(props: DropdownSubContentProps) {
  const [local, rest] = splitProps(props, ['depth', 'class', 'mount']);
  return (
    <KobalteDropdownMenu.Portal mount={local.mount}>
      <KobalteDropdownMenu.SubContent
        class={cn('flex flex-col size-auto z-action-menu gap-1 bg-[var(--b3)]', local.class)}
        depth={local.depth ?? 2}
        as={Surface}
        {...rest}
      />
    </KobalteDropdownMenu.Portal>
  );
}

function DropdownGroup(props: DropdownGroupProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteDropdownMenu.Group
      class={cn('flex flex-col p-1 gap-0.5 bg-surface', local.class)}
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
  Item: KobalteDropdownMenu.Item,                       /* todo */
  Icon: KobalteDropdownMenu.Icon,                       /* todo */
  Sub: KobalteDropdownMenu.Sub,                         /* todo */

  SubContent: DropdownSubContent,
  Content: DropdownContent,
  Trigger: DropdownTrigger,
  Group: DropdownGroup,
});
