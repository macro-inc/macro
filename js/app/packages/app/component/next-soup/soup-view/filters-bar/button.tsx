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
    'bg-ink text-page hover:bg-ink/90 active:bg-ink/80 data-[disabled]:bg-ink/50 data-[disabled]:text-page/70',
  // Medium emphasis - secondary actions (cancel, back)
  secondary:
    'bg-transparent text-ink border border-edge hover:bg-ink/8 active:bg-ink/12 data-[disabled]:text-ink-faint data-[disabled]:border-edge-muted',
  // Low emphasis - minimal actions (less important options)
  tertiary:
    'bg-ink/8 text-ink-muted hover:bg-ink/12 hover:text-ink active:bg-ink/15 data-[disabled]:bg-ink/5 data-[disabled]:text-ink-faint',
  // Dangerous actions (delete, remove, disconnect)
  destructive:
    'bg-transparent text-failure border border-failure/50 hover:bg-failure/10 active:bg-failure/20 data-[disabled]:text-failure/50 data-[disabled]:border-failure/30',
  // Minimal - no background, appears on hover
  ghost:
    'bg-transparent text-ink-muted hover:bg-ink/8 hover:text-ink active:bg-ink/12 data-[disabled]:text-ink-faint data-[disabled]:hover:bg-transparent',
  // Text link style
  link: 'bg-transparent text-accent underline-offset-2 hover:underline active:text-accent/80 data-[disabled]:text-accent/50 data-[disabled]:no-underline',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-2 py-1.5 text-xs gap-1',
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
        'inline-flex items-center justify-center font-medium rounded-md transition-colors',
        'focus-visible:outline-none',
        'data-[disabled]:cursor-not-allowed',
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
