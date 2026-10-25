import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { ComponentProps } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { createVariants, type VariantProps } from '../utils/variants';
import type { ButtonSize } from './Button';

type NativeInputSize = number;

/** Text-bearing Button sizes that also make sense for an input. */
export type InputSize = Exclude<ButtonSize, `icon-${string}`>;

// Single-line inputs are pills like Buttons on desktop, so their text sits further in.
const INPUT_SIZE_VARIANTS: Record<InputSize, string> = {
  xs: 'h-5 px-1.5 text-xs',
  sm: 'h-6 px-2.5 text-xs',
  md: 'h-8 px-3 text-base',
  lg: 'h-9 px-3.5 text-base',
  xl: 'h-12 px-4 text-base',
};

// Touch keeps its rounded fields and their original inset.
const TOUCH_INPUT_SHAPE: Record<InputSize, string> = {
  xs: 'rounded-lg px-1',
  sm: 'rounded-lg px-2',
  md: 'rounded-lg px-2',
  lg: 'rounded-lg px-3',
  xl: 'rounded-lg px-4',
};

/** Shared focus treatment for outlined text-entry controls. */
export const inputOutlineFocusClasses =
  'focus-visible:ring-2 focus-visible:ring-edge-muted';

/** Canonical visual variants for standalone inputs. */
export const inputVariants = createVariants(
  cn(
    'w-full min-w-0 border text-ink caret-current outline-none transition-[background-color,border-color,box-shadow] duration-120 motion-reduce:transition-none',
    'file:inline-flex file:border-0 file:bg-transparent file:text-[inherit] file:font-medium file:text-ink',
    'placeholder:text-ink-placeholder',
    'aria-invalid:border-failure aria-invalid:ring-2 aria-invalid:ring-failure/20',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
  ),
  {
    variant: {
      outline: cn(
        'border-edge-frame bg-control not-touch:elevated',
        inputOutlineFocusClasses
      ),
      bare: 'border-transparent bg-transparent',
    },
    size: INPUT_SIZE_VARIANTS,
  },
  {
    variant: 'outline',
    size: 'md',
  }
);

export type InputVariantProps = VariantProps<typeof inputVariants>;
export type InputVariant = NonNullable<InputVariantProps['variant']>;

export type InputClassOptions = {
  variant?: InputVariant;
  size?: InputSize;
  class?: string;
};

/** Returns canonical classes for a native input. */
export function inputClasses(options: InputClassOptions = {}): string {
  return cn(
    inputVariants({ variant: options.variant, size: options.size }),
    isTouchDevice() ? TOUCH_INPUT_SHAPE[options.size ?? 'md'] : 'rounded-full',
    options.class
  );
}

export type InputProps = Omit<ComponentProps<'input'>, 'size'> & {
  /** A Button-compatible visual size, or the native numeric HTML input size. */
  size?: InputSize | NativeInputSize;
  variant?: InputVariant;
};

/**
 * A thin shadcn-style native input using the app's tokens and control sizes.
 *
 * @do Use `TextField.Input` when the control needs a visible label,
 *   description, validation message, or controlled field value.
 * @do Use `InputGroup` when the input needs an icon, clear action, or adjacent
 *   button inside a shared frame.
 * @dont Do not use `variant="bare"` unless a composed parent owns the control
 *   boundary and focus treatment.
 */
export function Input(props: InputProps) {
  const [local, rest] = splitProps(props, ['class', 'size', 'variant']);
  const visualSize = (): InputSize =>
    typeof local.size === 'string' ? local.size : 'md';
  const nativeSize = () =>
    typeof local.size === 'number' ? local.size : undefined;

  return (
    <input
      data-input
      data-slot="input"
      data-variant={local.variant ?? 'outline'}
      data-size={visualSize()}
      size={nativeSize()}
      class={inputClasses({
        variant: local.variant,
        size: visualSize(),
        class: local.class,
      })}
      {...rest}
    />
  );
}
