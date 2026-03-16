import { Button as KButton, type ButtonRootProps } from '@kobalte/core/button';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '@ui/utils/classname';
import { type ParentProps, splitProps, type ValidComponent } from 'solid-js';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'destructive'
  | 'ghost'
  | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon-md' | 'icon-lg';

export type ButtonProps<T extends ValidComponent = 'button'> = ParentProps<
  PolymorphicProps<T, ButtonRootProps<T>> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    class?: string;
  }
>;

const variantStyles: Record<ButtonVariant, string> = {
  // High emphasis - main actions (submit, confirm, save)
  primary:
    'bg-ink text-page not-disabled:hover:bg-ink/90 not-disabled:active:bg-ink/80',
  // Medium emphasis - secondary actions (cancel, back)
  secondary:
    'bg-transparent text-ink border border-edge-muted not-disabled:hover:bg-ink/10 not-disabled:active:bg-ink/12',
  // Low emphasis - minimal actions (less important options)
  tertiary:
    'bg-ink/10 text-ink-muted not-disabled:hover:bg-ink/20 not-disabled:hover:text-ink not-disabled:active:bg-ink/15',
  // Dangerous actions (delete, remove, disconnect)
  destructive:
    'bg-transparent text-failure border border-failure/50 not-disabled:hover:bg-failure/10 not-disabled:active:bg-failure/20',
  // Minimal - no background, appears on hover
  ghost:
    'bg-transparent text-ink-muted not-disabled:hover:bg-ink/10 not-disabled:hover:text-ink not-disabled:active:bg-ink/12',
  // Text link style
  link: 'bg-transparent text-accent underline-offset-2 not-disabled:hover:underline not-disabled:active:text-accent/80',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-2 py-1 text-xs gap-1',
  md: 'px-3 py-2 text-sm gap-1.5',
  lg: 'px-4 py-2.5 text-base gap-2',
  // Icon sizes - square buttons for icon-only use
  // TODO: Remove if not needed - these can be replaced with `size="sm" class="aspect-square"`
  'icon-sm': 'p-1.5 size-7 [&_svg]:size-3.5',
  'icon-md': 'p-2 size-9 [&_svg]:size-4',
  'icon-lg': 'p-2.5 size-11 [&_svg]:size-5',
};

export const Button = <T extends ValidComponent = 'button'>(
  props: ButtonProps<T>
) => {
  const [local, others] = splitProps(props as ButtonProps<'button'>, [
    'variant',
    'size',
    'class',
    'children',
  ]);

  const variant = () => local.variant ?? 'primary';
  const size = () => local.size ?? 'md';

  return (
    <KButton
      class={cn(
        'inline-flex items-center justify-center font-medium rounded-md',
        'focus-visible:outline-none',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        variantStyles[variant()],
        sizeStyles[size()],
        local.class
      )}
      {...others}
    >
      {local.children}
    </KButton>
  );
};
