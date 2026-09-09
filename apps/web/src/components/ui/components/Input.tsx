import type { ComponentProps } from 'solid-js';
import { splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { createVariants, type VariantProps } from '../utils/variants';
import type { ButtonSize } from './Button';

type NativeInputSize = number;

/** Text-bearing Button sizes that also make sense for an input. */
export type InputSize = Exclude<ButtonSize, `icon-${string}`>;

const INPUT_SIZE_VARIANTS: Record<InputSize, string> = {
  xs: 'h-5 px-1 text-xs',
  sm: 'h-6 px-2 text-xs',
  md: 'h-8 px-2 text-sm',
  lg: 'h-9 px-3 text-base',
  xl: 'h-12 px-4 text-base',
};

/** Shared focus treatment for outlined text-entry controls. */
export const inputOutlineFocusClasses =
  'focus-visible:border-[color-mix(in_oklch,var(--color-edge)_80%,var(--color-ink))] focus-visible:ring-2 focus-visible:ring-edge-muted';

/** Canonical visual variants for standalone inputs. */
export const inputVariants = createVariants(
  cn(
    'w-full min-w-0 rounded-md border text-ink caret-current outline-none transition-[background-color,border-color,box-shadow]',
    'file:inline-flex file:border-0 file:bg-transparent file:text-[inherit] file:font-medium file:text-ink',
    'placeholder:text-ink-placeholder',
    'aria-invalid:border-failure aria-invalid:ring-2 aria-invalid:ring-failure/20',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50'
  ),
  {
    variant: {
      outline: cn('border-edge-muted bg-input', inputOutlineFocusClasses),
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
