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
*/

/*
// Kobalte's "grace polygon" keeps an open sub alive when the
// pointer crosses toward its content. For sibling In/From triggers,
// that means moving between them leaves the prior sub stuck open
// and the prior trigger stuck with data-highlighted. Force focus
// + open so Kobalte's parent selection manager updates to this
// trigger and the shared signal closes the sibling.
*/

// const DROPDOWN_CONTENT_CLASS = 'z-action-menu bg-surface rounded-xl ring-1 ring-edge shadow-[0_8px_24px_-16px_rgba(0,0,0,0.24),0_2px_8px_-6px_rgba(0,0,0,0.18)] p-1.5';
// const DROPDOWN_ITEM_CLASS = 'rounded-md hover:bg-ink/3 focus:bg-ink/3 data-[highlighted]:bg-ink/3';
// const DROPDOWN_SEPARATOR_CLASS = 'h-px bg-edge-muted border-0 -mx-1.5 my-1';

export type DropdownSubContentProps = ComponentProps<typeof KobalteDropdownMenu.SubContent> & { depth?: SurfaceProps['depth']; mount?: PortalMount; };
export type DropdownContentProps = ComponentProps<typeof KobalteDropdownMenu.Content> & { depth?: SurfaceProps['depth']; mount?: PortalMount; };
export type DropdownTriggerProps = ComponentProps<typeof KobalteDropdownMenu.Trigger> & ButtonProps;
export type DropdownItemIndicatorProps = ComponentProps<typeof KobalteDropdownMenu.ItemIndicator>;
export type DropdownSubTriggerProps = ComponentProps<typeof KobalteDropdownMenu.SubTrigger>;
export type DropdownRadioItemProps = ComponentProps<typeof KobalteDropdownMenu.RadioItem>;
export type DropdownGroupProps = ComponentProps<typeof KobalteDropdownMenu.Group>;
export type DropdownItemProps = ComponentProps<typeof KobalteDropdownMenu.Item>;
export type DropdownSubProps = ComponentProps<typeof KobalteDropdownMenu.Sub>;
type PortalMount = ComponentProps<typeof KobalteDropdownMenu.Portal>['mount'];

const ROW_CLASS =    'rounded-lg w-full flex items-center gap-2.5 px-2 h-8  text-left text-xs cursor-default outline-none hover:bg-ink/5 data-highlighted:bg-ink/5 data-disabled:opacity-50 data-disabled:cursor-not-allowed';
const CONTENT_CLASS ='rounded-xl flex flex-col size-auto z-action-menu gap-1 bg-edge-muted ';

function DropdownContent(props: DropdownContentProps) {
  const [local, rest] = splitProps(props, ['depth', 'class', 'mount']);
  return (
    <KobalteDropdownMenu.Portal mount={local.mount}>
      <KobalteDropdownMenu.Content
        class={cn(CONTENT_CLASS, local.class)}
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
        class={cn(CONTENT_CLASS, local.class)}
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
      class={cn('flex flex-col p-1.5 gap-0.5 bg-surface', local.class)}
      {...rest}
    />
  );
}

function DropdownItemIndicator(props: DropdownItemIndicatorProps) {
  return <KobalteDropdownMenu.ItemIndicator {...props} />;
}

function DropdownSubTrigger(props: DropdownSubTriggerProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteDropdownMenu.SubTrigger
      class={cn(ROW_CLASS, 'justify-between', local.class)}
      {...rest}
    />
  );
}

function DropdownRadioItem(props: DropdownRadioItemProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteDropdownMenu.RadioItem
      class={cn(ROW_CLASS, local.class)}
      {...rest}
    />
  );
}

function DropdownSub(props: DropdownSubProps) {
  return (
    <KobalteDropdownMenu.Sub
      gutter={12}
      {...props}
    />
  );
}

function DropdownItem(props: DropdownItemProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteDropdownMenu.Item
      class={cn(ROW_CLASS, local.class)}
      {...rest}
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

export const Dropdown = Object.assign((props: ComponentProps<typeof KobalteDropdownMenu>) => (<KobalteDropdownMenu {...props} />), {
  RadioGroup: KobalteDropdownMenu.RadioGroup, /* passthrough — pure logical wrapper */
  Separator: KobalteDropdownMenu.Separator, /* passthrough — styled via class at use sites */
  ItemIndicator: DropdownItemIndicator,
  SubContent: DropdownSubContent,
  SubTrigger: DropdownSubTrigger,
  RadioItem: DropdownRadioItem,
  Content: DropdownContent,
  Trigger: DropdownTrigger,
  Group: DropdownGroup,
  Item: DropdownItem,
  Sub: DropdownSub,
});
