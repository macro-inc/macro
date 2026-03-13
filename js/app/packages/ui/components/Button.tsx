import CaretDown from '@phosphor-icons/core/regular/caret-down.svg';
import { cn } from '@ui/utils/classname';
import { Tooltip } from 'core/component/Tooltip';
import { type JSX, type ParentComponent, Show, splitProps } from 'solid-js';

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
  showChevron?: boolean;
  suppressInteractionStyling?: boolean;
};

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-ink text-page not-disabled:hover:bg-ink/90 not-disabled:active:bg-ink/80',
  secondary:
    'bg-transparent text-ink border border-edge-muted not-disabled:hover:bg-ink/10 not-disabled:active:bg-ink/12',
  tertiary:
    'bg-ink/10 text-ink-muted not-disabled:hover:bg-ink/20 not-disabled:hover:text-ink not-disabled:active:bg-ink/15',
  destructive:
    'bg-transparent text-failure border border-failure/50 not-disabled:hover:bg-failure/10 not-disabled:active:bg-failure/20',
  ghost:
    'bg-transparent text-ink-muted not-disabled:hover:bg-ink/10 not-disabled:hover:text-ink not-disabled:active:bg-ink/12',
  link: 'bg-transparent text-accent underline-offset-2 not-disabled:hover:underline not-disabled:active:text-accent/80',
  accent:
    'bg-accent text-page not-disabled:hover:bg-accent/90 not-disabled:active:bg-accent/80',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-2 py-1 text-xs gap-1',
  md: 'px-3 py-2 text-sm gap-1.5',
  lg: 'px-4 py-2.5 text-base gap-2',
  'icon-sm': 'p-1.5 size-7 [&_svg]:size-3.5',
  'icon-md': 'p-2 size-9 [&_svg]:size-4',
  'icon-lg': 'p-2.5 size-11 [&_svg]:size-5',
};

/**
 * ### The basic button component. When in doubt, use Button.
 *
 * @param props.variant - primary, secondary, tertiary (default), destructive, ghost, or link.
 * @param props.size - sm, md (default), lg, icon-sm, icon-md, or icon-lg.
 * @param props.tooltip - Optional tooltip content to display when hovering over the button.
 * @param props.class - Use for custom styling. Tailwind will be merged automatically, be granular as you like.
 * @param props.showChevron - Show an indicator
 * @param props.suppressInteractionStyling - Override the default interaction styling, e.g. hover bg changes
 * @param props.children - Labels, icons, hotkey hints, etc. The body of the button.
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
 *   <EntityIcon targetType="pdf" theme='monochrome' size="md" />
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
    'showChevron',
    'suppressInteractionStyling',
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
          'disabled:cursor-not-allowed disabled:opacity-50',
          'touch:min-h-11 touch:min-w-11 touch:[&_svg]:size-6',
          !local.suppressInteractionStyling && variantStyles[variant()],
          sizeStyles[size()],
          local.showChevron && 'p-0 gap-0 items-stretch',
          local.class
        )}
        {...buttonAttributes}
      >
        {local.children}

        <Show when={!!local.showChevron}>
          <CaretDown class="flex w-3 hover:bg-panel" />
        </Show>
      </button>
    </MaybeWrapInTooltip>
  );
};
