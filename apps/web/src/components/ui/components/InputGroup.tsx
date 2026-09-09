import XIcon from '@phosphor/x.svg';
import { mergeRefs } from '@solid-primitives/refs';
import {
  type Accessor,
  type ComponentProps,
  createContext,
  createSignal,
  Show,
  splitProps,
  useContext,
} from 'solid-js';
import { cn } from '../utils/classname';
import { createVariants, type VariantProps } from '../utils/variants';
import { Button, type ButtonProps, type ButtonSize } from './Button';
import { useButtonGroupContext } from './ButtonGroup';
import {
  Input,
  type InputProps,
  type InputSize,
  type InputVariant,
} from './Input';

const INPUT_GROUP_SIZE_VARIANTS: Record<InputSize, string> = {
  xs: 'h-5 text-xs',
  sm: 'h-6 text-xs',
  md: 'h-8 text-sm',
  lg: 'h-9 text-base',
  xl: 'h-12 text-base',
};

const INPUT_GROUP_ADDON_PADDING: Record<
  InputSize,
  { start: string; end: string; buttonEnd: string }
> = {
  xs: {
    start: 'ps-1',
    end: 'pe-1',
    buttonEnd: '[&:has([data-button])]:pe-0',
  },
  sm: {
    start: 'ps-2',
    end: 'pe-2',
    buttonEnd: '[&:has([data-button])]:pe-0',
  },
  md: {
    start: 'ps-2',
    end: 'pe-2',
    buttonEnd: '[&:has([data-button])]:pe-1',
  },
  lg: {
    start: 'ps-3',
    end: 'pe-3',
    buttonEnd: '[&:has([data-button])]:pe-0.5',
  },
  xl: {
    start: 'ps-4',
    end: 'pe-4',
    buttonEnd: '[&:has([data-button])]:pe-1.5',
  },
};

const INPUT_GROUP_BUTTON_SIZE: Record<InputSize, ButtonSize> = {
  xs: 'icon-xs',
  sm: 'icon-sm',
  md: 'sm',
  lg: 'md',
  xl: 'lg',
};

/** Canonical variants for a framed input composition. */
export const inputGroupVariants = createVariants(
  cn(
    'group/input-group relative flex w-full min-w-0 items-center overflow-hidden rounded-md border transition-[background-color,border-color,box-shadow]',
    'has-[[data-slot=input-group-control]:disabled]:pointer-events-none has-[[data-slot=input-group-control]:disabled]:opacity-50',
    'has-[[data-slot=input-group-control][aria-invalid=true]]:border-failure has-[[data-slot=input-group-control][aria-invalid=true]]:ring-2 has-[[data-slot=input-group-control][aria-invalid=true]]:ring-failure/20'
  ),
  {
    variant: {
      outline: cn(
        'border-edge-muted bg-input',
        'has-[[data-slot=input-group-control]:focus-visible]:border-[color-mix(in_oklch,var(--color-edge)_80%,var(--color-ink))] has-[[data-slot=input-group-control]:focus-visible]:ring-2 has-[[data-slot=input-group-control]:focus-visible]:ring-edge-muted'
      ),
      bare: 'border-transparent bg-transparent',
    },
    size: INPUT_GROUP_SIZE_VARIANTS,
  },
  { variant: 'outline', size: 'md' }
);

export type InputGroupVariantProps = VariantProps<typeof inputGroupVariants>;
export type InputGroupAddonAlign = 'inline-start' | 'inline-end';

type InputGroupContextValue = {
  readonly size: InputSize;
  registerControl: (
    control: HTMLInputElement,
    hasValue: Accessor<boolean>,
    canClear: Accessor<boolean>
  ) => void;
  hasValue: Accessor<boolean>;
  canClear: Accessor<boolean>;
  clear: () => void;
  focus: () => void;
};

const InputGroupContext = createContext<InputGroupContextValue>();

function useInputGroupContext(): InputGroupContextValue {
  const context = useContext(InputGroupContext);
  if (!context) {
    throw new Error('InputGroup slots must be used inside InputGroup');
  }
  return context;
}

export type InputGroupProps = Omit<ComponentProps<'div'>, 'size'> & {
  size?: InputSize;
  variant?: InputVariant;
};

function InputGroupRoot(props: InputGroupProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'size',
    'variant',
  ]);
  const buttonGroup = useButtonGroupContext();
  const [control, setControl] = createSignal<HTMLInputElement>();
  const [hasValueReader, setHasValueReader] = createSignal<Accessor<boolean>>(
    () => false
  );
  const [canClearReader, setCanClearReader] = createSignal<Accessor<boolean>>(
    () => false
  );
  const inheritedSize = (): InputSize | undefined => {
    const size = buttonGroup?.size;
    return size && !size.startsWith('icon-') ? (size as InputSize) : undefined;
  };
  const size = (): InputSize => local.size ?? inheritedSize() ?? 'md';
  const variant = (): InputVariant =>
    local.variant ?? (buttonGroup?.variant === 'ghost' ? 'bare' : 'outline');
  const grouped = () => buttonGroup !== undefined;

  const context: InputGroupContextValue = {
    get size() {
      return size();
    },
    registerControl(element, hasValue, canClear) {
      setControl(element);
      setHasValueReader(() => hasValue);
      setCanClearReader(() => canClear);
    },
    hasValue: () => hasValueReader()(),
    canClear: () => canClearReader()(),
    clear() {
      const element = control();
      if (!element) return;
      element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      queueMicrotask(() => element.focus());
    },
    focus: () => control()?.focus(),
  };

  return (
    <InputGroupContext.Provider value={context}>
      <div
        data-slot="input-group"
        data-size={size()}
        data-variant={variant()}
        data-grouped={grouped() ? '' : undefined}
        role="group"
        class={cn(
          inputGroupVariants({ size: size(), variant: variant() }),
          grouped() &&
            'flex-1 rounded-none border-0 bg-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0',
          local.class
        )}
        {...rest}
      >
        {local.children}
      </div>
    </InputGroupContext.Provider>
  );
}

export type InputGroupInputProps = Omit<InputProps, 'size' | 'variant'>;

function InputGroupInput(props: InputGroupInputProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'disabled',
    'readOnly',
    'ref',
    'value',
  ]);
  const group = useInputGroupContext();
  const [hasUncontrolledValue, setHasUncontrolledValue] = createSignal(false);
  const hasValue = () =>
    local.value === undefined
      ? hasUncontrolledValue()
      : String(local.value).length > 0;
  const canClear = () => !local.disabled && !local.readOnly;
  const attach = (element: HTMLInputElement) => {
    setHasUncontrolledValue(element.value.length > 0);
    group.registerControl(element, hasValue, canClear);
  };

  return (
    <Input
      ref={mergeRefs(attach, local.ref)}
      value={local.value}
      disabled={local.disabled}
      readOnly={local.readOnly}
      size={group.size}
      variant="bare"
      data-slot="input-group-control"
      class={cn(
        'h-full flex-1 rounded-none border-0 bg-transparent px-2 focus-visible:ring-0 aria-invalid:ring-0 [&::-webkit-search-cancel-button]:hidden',
        local.class
      )}
      on:input={(event) =>
        setHasUncontrolledValue(event.currentTarget.value.length > 0)
      }
      {...rest}
    />
  );
}

export type InputGroupAddonProps = ComponentProps<'div'> & {
  align?: InputGroupAddonAlign;
};

function InputGroupAddon(props: InputGroupAddonProps) {
  const [local, rest] = splitProps(props, ['align', 'children', 'class']);
  const group = useInputGroupContext();
  const align = () => local.align ?? 'inline-start';
  const padding = () => INPUT_GROUP_ADDON_PADDING[group.size];

  return (
    <div
      data-slot="input-group-addon"
      data-align={align()}
      class={cn(
        'flex shrink-0 items-center justify-center text-ink-subtle [&>svg]:pointer-events-none [&>svg]:shrink-0 [&>svg:not([class*=size-])]:size-[1em]',
        align() === 'inline-start'
          ? cn('order-first pe-0', padding().start)
          : cn('order-last ps-0', padding().end, padding().buttonEnd),
        local.class
      )}
      on:click={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        group.focus();
      }}
      {...rest}
    >
      {local.children}
    </div>
  );
}

export type InputGroupButtonProps = ButtonProps;

function InputGroupButton(props: InputGroupButtonProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'noTouchResize',
    'size',
    'square',
    'variant',
  ]);
  const group = useInputGroupContext();

  return (
    <Button
      variant={local.variant ?? 'ghost'}
      size={local.size ?? INPUT_GROUP_BUTTON_SIZE[group.size]}
      square={local.square}
      noTouchResize={local.noTouchResize ?? true}
      class={cn('rounded-sm', local.class)}
      {...rest}
    />
  );
}

export type InputGroupClearButtonProps = { class?: string };

function InputGroupClearButton(props: InputGroupClearButtonProps) {
  const group = useInputGroupContext();

  return (
    <Show when={group.hasValue() && group.canClear()}>
      <InputGroupButton
        type="button"
        square
        aria-label="Clear input"
        class={props.class}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => group.clear()}
      >
        <XIcon />
      </InputGroupButton>
    </Show>
  );
}

/**
 * A shared input frame for icons, inline actions, and adjacent Buttons.
 *
 * @do Put exactly one `InputGroup.Input` inside the root.
 * @do Put icons and actions in `InputGroup.Addon` and set their visual edge
 *   with `align`; DOM order does not determine placement.
 * @do Use `InputGroup.ClearButton` for the standard reactive clear action.
 * @do Nest the root in `ButtonGroup` when it must share a frame with sibling
 *   Buttons; size and framing are inherited by the group, not the input.
 */
export const InputGroup = Object.assign(InputGroupRoot, {
  Addon: InputGroupAddon,
  Button: InputGroupButton,
  ClearButton: InputGroupClearButton,
  Input: InputGroupInput,
});
