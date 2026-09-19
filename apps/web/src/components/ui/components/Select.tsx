import type {
  SelectContentProps as KobalteSelectContentProps,
  SelectIconProps as KobalteSelectIconProps,
  SelectItemIndicatorProps as KobalteSelectItemIndicatorProps,
  SelectItemLabelProps as KobalteSelectItemLabelProps,
  SelectItemProps as KobalteSelectItemProps,
  SelectListboxProps as KobalteSelectListboxProps,
  SelectPortalProps as KobalteSelectPortalProps,
  SelectRootProps as KobalteSelectRootProps,
  SelectTriggerProps as KobalteSelectTriggerProps,
  SelectValueProps as KobalteSelectValueProps,
  SelectRootItemComponentProps,
} from '@kobalte/core/select';
import { Select as KobalteSelect } from '@kobalte/core/select';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import { type Component, createSignal, type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Layer } from './Layer';
import type { SurfaceProps } from './Surface';

export type SelectTriggerProps = KobalteSelectTriggerProps & {
  class?: string;
  children?: JSX.Element;
};

function SelectTrigger(props: SelectTriggerProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteSelect.Trigger
      class={cn(
        'flex w-full items-center justify-between gap-2 text-left data-expanded:bg-hover',
        local.class
      )}
      {...rest}
    />
  );
}

export type SelectValueProps<Option> = KobalteSelectValueProps<Option> & {
  class?: string;
};

function SelectValue<Option>(props: SelectValueProps<Option>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteSelect.Value<Option>
      class={cn('min-w-0 flex-1 truncate', local.class)}
      {...rest}
    />
  );
}

export type SelectIconProps = KobalteSelectIconProps & {
  class?: string;
  children?: JSX.Element;
};

function SelectIcon(props: SelectIconProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <KobalteSelect.Icon
      class={cn('shrink-0 text-ink-extra-muted', local.class)}
      {...rest}
    >
      {local.children ?? <CaretDownIcon class="size-3" />}
    </KobalteSelect.Icon>
  );
}

type PortalMount = KobalteSelectPortalProps['mount'];
type SelectPortalScope = 'local';

export type SelectContentProps = KobalteSelectContentProps & {
  class?: string;
  children?: JSX.Element;
  depth?: SurfaceProps['depth'];
  mount?: PortalMount;
  portalScope?: SelectPortalScope;
};

function resolvePortalMount(
  searchRef: HTMLElement | undefined,
  mount: PortalMount,
  portalScope: SelectPortalScope | undefined
): PortalMount {
  if (mount || portalScope !== 'local') return mount;
  return searchRef?.closest<HTMLElement>('.portal-scope') ?? undefined;
}

function SelectContent(props: SelectContentProps) {
  const [searchRef, setSearchRef] = createSignal<HTMLDivElement>();
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'depth',
    'mount',
    'portalScope',
  ]);
  return (
    <>
      <div class="hidden" ref={setSearchRef} />
      <KobalteSelect.Portal
        mount={resolvePortalMount(searchRef(), local.mount, local.portalScope)}
      >
        <Layer depth={local.depth ?? 3}>
          <KobalteSelect.Content
            class={cn(
              'z-action-menu max-h-[var(--kb-popper-content-available-height)] min-w-[var(--kb-popper-anchor-width)] overflow-y-auto rounded-xl border border-edge bg-menu p-1.5 shadow-menu menu-open-animation',
              local.class
            )}
            {...rest}
          >
            {local.children}
          </KobalteSelect.Content>
        </Layer>
      </KobalteSelect.Portal>
    </>
  );
}

export type SelectListboxProps<
  Option = unknown,
  OptGroup = never,
> = KobalteSelectListboxProps<Option, OptGroup> & {
  class?: string;
};

function SelectListbox<Option, OptGroup = never>(
  props: SelectListboxProps<Option, OptGroup>
) {
  const [local, rest] = splitProps(props, ['class', 'ref']);
  return (
    <KobalteSelect.Listbox<Option, OptGroup>
      ref={(element) => {
        if (typeof local.ref === 'function') local.ref(element);
      }}
      class={cn('flex flex-col gap-(--app-border-width)', local.class)}
      {...rest}
    />
  );
}

export type SelectItemProps = KobalteSelectItemProps & {
  class?: string;
  children?: JSX.Element;
};

function SelectItem(props: SelectItemProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteSelect.Item
      class={cn(
        'group flex w-full cursor-default items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-normal text-ink outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-hover',
        local.class
      )}
      {...rest}
    />
  );
}

export type SelectItemLabelProps = KobalteSelectItemLabelProps & {
  class?: string;
  children?: JSX.Element;
};

function SelectItemLabel(props: SelectItemLabelProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <KobalteSelect.ItemLabel
      class={cn('min-w-0 flex-1 truncate', local.class)}
      {...rest}
    />
  );
}

export type SelectItemIndicatorProps = KobalteSelectItemIndicatorProps & {
  class?: string;
  children?: JSX.Element;
};

function SelectItemIndicator(props: SelectItemIndicatorProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <KobalteSelect.ItemIndicator
      class={cn('shrink-0 text-accent', local.class)}
      {...rest}
    >
      {local.children ?? <CheckIcon class="size-3.5" />}
    </KobalteSelect.ItemIndicator>
  );
}

export type SelectRootProps<Option, OptGroup = never> = KobalteSelectRootProps<
  Option,
  OptGroup
> & {
  class?: string;
  children?: JSX.Element;
};

function SelectRoot<Option, OptGroup = never>(
  props: SelectRootProps<Option, OptGroup>
) {
  const DefaultItem: Component<SelectRootItemComponentProps<Option>> = (
    itemProps
  ) => (
    <SelectItem item={itemProps.item}>
      <SelectItemLabel>{itemProps.item.textValue}</SelectItemLabel>
      <SelectItemIndicator />
    </SelectItem>
  );

  return (
    <KobalteSelect<Option, OptGroup>
      gutter={props.gutter ?? 4}
      placement={props.placement ?? 'bottom-start'}
      shouldFocusWrap={props.shouldFocusWrap ?? true}
      {...props}
      itemComponent={props.itemComponent ?? DefaultItem}
    />
  );
}

/** Composable, styled single- or multi-value select built on Kobalte. */
export const Select = Object.assign(SelectRoot, {
  Content: SelectContent,
  Icon: SelectIcon,
  Item: SelectItem,
  ItemIndicator: SelectItemIndicator,
  ItemLabel: SelectItemLabel,
  Listbox: SelectListbox,
  Trigger: SelectTrigger,
  Value: SelectValue,
  Description: KobalteSelect.Description,
  ErrorMessage: KobalteSelect.ErrorMessage,
  Label: KobalteSelect.Label,
  Section: KobalteSelect.Section,
});
