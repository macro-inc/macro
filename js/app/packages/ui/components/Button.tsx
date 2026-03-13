import { Button as KButton, type ButtonRootProps } from '@kobalte/core/button';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import { cn } from '@ui/utils/classname';
import { Tooltip } from 'core/component/Tooltip';
import { type JSX, splitProps, type ValidComponent } from 'solid-js';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'destructive'
  | 'ghost'
  | 'link'
  | 'accent';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon-md' | 'icon-lg';

export type ButtonProps<T extends ValidComponent = 'button'> = PolymorphicProps<
  T,
  ButtonRootProps<T>
> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  tooltip?: JSX.Element;
  class?: string;
  children?: JSX.Element;
};

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-page not-disabled:hover:bg-ink/90 not-disabled:active:bg-ink/80 disabled:bg-ink-extra-muted',
  secondary:
    'bg-transparent text-ink border border-edge-muted not-disabled:hover:bg-ink/10 not-disabled:active:bg-ink/12 disabled:opacity-30',
  tertiary:
    'bg-ink/10 text-ink-muted not-disabled:hover:bg-ink/20 not-disabled:hover:text-ink not-disabled:active:bg-ink/15 disabled:opacity-50',
  destructive:
    'bg-transparent text-failure border border-failure/50 not-disabled:hover:bg-failure/10 not-disabled:active:bg-failure/20 disabled:opacity-50',
  ghost:
    'bg-transparent text-ink-muted not-disabled:hover:bg-ink/10 not-disabled:hover:text-ink not-disabled:active:bg-ink/12 disabled:opacity-30',
  link: 'bg-transparent text-accent underline-offset-2 not-disabled:hover:underline not-disabled:active:text-accent/80 disabled:text-ink-extra-muted',
  accent:
    'bg-accent text-page not-disabled:hover:bg-accent/90 not-disabled:active:bg-accent/80 disabled:bg-ink-extra-muted',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'p-1 text-xs gap-1',
  md: 'p-2 text-sm gap-1.5',
  lg: 'p-2.5 text-base gap-2',
  'icon-sm': 'p-1 size-7 [&_svg]:size-5',
  'icon-md': 'p-1.5 size-9 [&_svg]:size-6',
  'icon-lg': 'p-2 size-11 [&_svg]:size-7',
};

/**
 * ### The basic button component. When in doubt, use Button.
 *
 * Supports polymorphism via Kobalte's `as` prop — render as any element or component
 * while retaining button styles and behaviour.
 *
 * @param props.variant - primary, secondary, tertiary, destructive, ghost (default), link, or accent.
 * @param props.size - sm, md (default), lg, icon-sm, icon-md, or icon-lg.
 * @param props.tooltip - Optional tooltip content to display when hovering over the button.
 * @param props.as - Override the rendered element (e.g. `"a"` or a router `<Link>` component).
 *
 * @example
 * <Button variant="primary" disabled>
 *   Save
 * </Button>
 *
 * @example
 * // Render as an anchor link
 * <Button as="a" href="/dashboard" variant="secondary">
 *   Go to Dashboard
 * </Button>
 *
 * @example
 * // Icon button wrapped in Tooltip with Hotkey
 * <Button
 *   variant="primary"
 *   size="icon-md"
 *   tooltip={<LabelAndHotKey label="Save" shortcut="cmd+s" />}
 * >
 *   <ClipboardIcon />
 * </Button>
 */
export const Button = <T extends ValidComponent = 'button'>(
  props: ButtonProps<T>
) => {
  const [local, others] = splitProps(props as ButtonProps<'button'>, [
    'variant',
    'size',
    'class',
    'children',
    'tooltip',
  ]);

  const variant = () => local.variant ?? 'ghost';
  const size = () => local.size ?? 'md';

  function MaybeWrapInTooltip(wrapProps: { children: JSX.Element }) {
    if (!local.tooltip) return wrapProps.children;
    return <Tooltip tooltip={local.tooltip}>{wrapProps.children}</Tooltip>;
  }

  return (
    <MaybeWrapInTooltip>
      <KButton
        class={cn(
          'relative inline-flex items-center justify-center font-medium leading-none border border-transparent',
          'data-[disabled]:cursor-not-allowed',
          'touch:min-h-11 touch:min-w-11 touch:[&_svg]:size-6',
          variantStyles[variant()],
          sizeStyles[size()],
          local.class
        )}
        {...others}
      >
        {local.children}
      </KButton>
    </MaybeWrapInTooltip>
  );
};
