import { DropdownMenu as KobalteDropdownMenu } from '@kobalte/core/dropdown-menu';
import { type ComponentProps, type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';

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

export type DropdownTriggerProps = ComponentProps<typeof KobalteDropdownMenu.Trigger> & {
  children?: JSX.Element;
  class?: string;
};

function DropdownTrigger(props: DropdownTriggerProps) {
  const [local, others] = splitProps(props, ['class', 'children']);

  return (
    <KobalteDropdownMenu.Trigger
      class={cn(
        'bg-transparent [&_svg]:size-4 outline-none text-ink text-xs font-medium leading-none whitespace-nowrap', /* Color & typography */
        'relative inline-flex items-center justify-center gap-1 h-7 px-2',                                        /* Layout: 28px tall, padded, flex row with small gap */
        'not-disabled:hover:bg-ink/10 not-disabled:active:bg-ink/12',                                             /* Enabled State */
        'disabled:opacity-30 disabled:cursor-not-allowed',                                                        /* Disabled State */
        'rounded-xs border border-edge-muted',                                                                    /* Shape & border (uniform edge-muted border) */
        local.class
      )}
      {...others}
    >
      {local.children}
    </KobalteDropdownMenu.Trigger>
  );
};


export const Dropdown = Object.assign(
  (props: ComponentProps<typeof KobalteDropdownMenu>) => (
    <KobalteDropdownMenu {...props} />
  ),
  {
    ItemDescription: KobalteDropdownMenu.ItemDescription,
    ItemIndicator: KobalteDropdownMenu.ItemIndicator,
    CheckboxItem: KobalteDropdownMenu.CheckboxItem,
    RadioGroup: KobalteDropdownMenu.RadioGroup,
    GroupLabel: KobalteDropdownMenu.GroupLabel,
    SubContent: KobalteDropdownMenu.SubContent,
    SubTrigger: KobalteDropdownMenu.SubTrigger,
    ItemLabel: KobalteDropdownMenu.ItemLabel,
    RadioItem: KobalteDropdownMenu.RadioItem,
    Content: KobalteDropdownMenu.Content,
    Portal: KobalteDropdownMenu.Portal,
    Group: KobalteDropdownMenu.Group,
    Item: KobalteDropdownMenu.Item,
    Icon: KobalteDropdownMenu.Icon,
    Sub: KobalteDropdownMenu.Sub,
    Trigger: DropdownTrigger,
  }
);
