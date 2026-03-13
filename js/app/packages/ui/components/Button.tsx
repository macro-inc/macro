import { cn } from '@ui/utils/classname';
import { Tooltip } from 'core/component/Tooltip';
import { type JSX, type ParentComponent, splitProps } from 'solid-js';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'destructive'
  | 'ghost'
  | 'link'
  | 'accent';

export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon-md' | 'icon-lg';

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  tooltip?: JSX.Element;
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
 * @param props.variant - primary, secondary, tertiary (default), destructive, ghost, or link.
 * @param props.size - sm, md (default), lg, icon-sm, icon-md, or icon-lg.
 * @param props.tooltip - Optional tooltip content to display when hovering over the button.
 *
 * @example
 * <Button variant="primary" disabled>
 *   Save
 * </Button>
 *
 * @example
 * // Icon button wrapped in Tooltip with Hotkey
 * <Button
 *   variant="primary"
 *   size="icon-md"
 *   tooltip={<LabelAndHotKey label="Save" shortcut='cmd+s' />}
 * >
 *    <ClipboardIcon />
 * </Button>
 *
 */
export const Button: ParentComponent<ButtonProps> = (props) => {
  const [local, buttonAttributes] = splitProps(props, [
    'variant',
    'size',
    'class',
    'children',
    'tooltip',
    'type',
  ]);

  const variant = () => local.variant ?? 'ghost';
  const size = () => local.size ?? 'md';

  function MaybeWrapInTooltip(props: { children: JSX.Element }) {
    if (!local.tooltip) return props.children;

    return <Tooltip tooltip={local.tooltip}>{props.children}</Tooltip>;
  }

  return (
    <MaybeWrapInTooltip>
      <button
        type={local.type ?? 'button'}
        class={cn(
          'relative inline-flex items-center justify-center font-medium leading-none border border-transparent',
          'disabled:cursor-not-allowed',
          'touch:min-h-11 touch:min-w-11 touch:[&_svg]:size-6',
          variantStyles[variant()],
          sizeStyles[size()],
          local.class
        )}
        {...buttonAttributes}
      >
        {local.children}
      </button>
    </MaybeWrapInTooltip>
  );
};
