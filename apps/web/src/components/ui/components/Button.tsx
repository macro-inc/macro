import type { HotkeyToken } from '@core/hotkey/tokens';
import type { Placement } from '@floating-ui/dom';
import {
  type ButtonRootProps,
  Button as KobalteButton,
} from '@kobalte/core/button';
import { type ComponentProps, type JSX, Show, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { CONTROL_SIZE_VARIANTS } from '../utils/controlSizes';
import { createVariants, type VariantProps } from '../utils/variants';
import { useButtonGroupContext } from './ButtonGroup';
import { Layer } from './Layer';
import { Tooltip } from './Tooltip';

const BUTTON_TOUCH_STYLES =
  "touch:min-h-9 touch:min-w-9 touch:[&>svg:not([class*='size-'])]:size-6";

// Hover/press feedback is painted as a translucent scrim *on top of* each
// variant's base background-color (via the `overlay-*` background-image utility)
// rather than replacing/thinning the base color, so buttons keep their full
// color on hover. The `cta`/`contrast` variants use a surface scrim so their
// solid backgrounds lighten toward the text color instead of washing out.
/** Canonical variant classes for buttons and button-like elements. */
export const buttonVariants = createVariants(
  cn(
    'relative inline-flex shrink-0 items-center justify-center whitespace-nowrap text-sm',
    'rounded-md border border-transparent font-medium outline-none select-none transition-colors',
    'data-disabled:cursor-not-allowed data-disabled:opacity-30',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0'
  ),
  {
    variant: {
      danger:
        'bg-failure-bg text-failure dark:bg-failure-bg not-disabled:hover:bg-failure/25 not-disabled:active:bg-failure/30',
      outline:
        'bg-transparent text-ink-muted border-edge-muted not-disabled:hover:bg-hover not-disabled:hover:text-ink not-disabled:active:bg-active',
      accent: 'bg-accent-bg not-disabled:hover:overlay-accent-bg text-accent',
      success:
        'bg-success-bg not-disabled:hover:overlay-success-bg text-success',
      ghost:
        'bg-transparent text-ink-muted not-disabled:hover:overlay-hover not-disabled:hover:text-ink not-disabled:active:overlay-active',
      strong:
        'bg-ink text-surface-4 focus-visible:ring-surface-4/70 not-disabled:hover:overlay-[color-mix(in_oklch,var(--color-surface-4)_12%,transparent)] not-disabled:active:overlay-[color-mix(in_oklch,var(--color-surface-4)_22%,transparent)]',
      cta: 'bg-accent text-accent-contrast focus-visible:ring-accent-contrast/70 [--color-edge:var(--color-accent-contrast-muted)] [--color-edge-muted:var(--color-accent-contrast-muted)] not-disabled:hover:overlay-[color-mix(in_oklch,var(--color-surface)_12%,transparent)] not-disabled:active:overlay-[color-mix(in_oklch,var(--color-surface)_22%,transparent)]',
    },
    size: {
      xs: "h-5 gap-1 px-1 text-xs [&>svg:not([class*='size-'])]:size-3",
      'icon-xs': "size-5 p-0.5 [&>svg:not([class*='size-'])]:size-4",
      sm: CONTROL_SIZE_VARIANTS.sm,
      md: CONTROL_SIZE_VARIANTS.md,
      lg: `${CONTROL_SIZE_VARIANTS.lg} rounded-lg`,
      xl: "h-12 gap-2 px-4 text-base rounded-lg [&>svg:not([class*='size-'])]:size-5",
      'icon-lg':
        "size-11 aspect-square p-2 [&>svg:not([class*='size-'])]:size-7",
      'icon-md':
        "size-9 aspect-square p-1.5 [&>svg:not([class*='size-'])]:size-6",
      'icon-sm':
        "size-6 aspect-square p-1 [&>svg:not([class*='size-'])]:size-4",
    },
  },
  {
    variant: 'ghost',
    size: 'md',
  }
);

/** Variant props inferred from the canonical button variant definition. */
export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
export type ButtonVariant = NonNullable<ButtonVariantProps['variant']>;
export type ButtonSize = NonNullable<ButtonVariantProps['size']>;

export type ButtonClassOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  noTouchResize?: boolean;
  square?: boolean;
  class?: string;
};

export type ButtonProps = ButtonRootProps<'button'> &
  ComponentProps<'button'> & {
    depth?: 0 | 1 | 2 | 3 | 4;
    tooltipPlacement?: Placement;
    /**
     * Stretch the button (and, when a tooltip wraps it, the tooltip's trigger
     * wrapper) to fill the available width. Without this the tooltip wrapper is
     * `inline-flex` and collapses a `w-full` button to its content width.
     */
    fullWidth?: boolean;
    noTouchResize?: boolean;
    square?: boolean;
    variant?: ButtonVariant;
    children?: JSX.Element;
    /**
     * Accessible name for the button. Also used as the tooltip unless
     * `tooltip` provides different content.
     */
    label?: string;
    /**
     * Tooltip content. For icon buttons, this is also used as a backwards-
     * compatible accessible-name fallback when no label is provided.
     */
    tooltip?: string;
    hotkey?: HotkeyToken | HotkeyToken[];
    /**
     * Raw shortcut string(s) shown in the tooltip when no `hotkey` token is available.
     */
    shortcut?: string | string[];
    size?: ButtonSize;
    class?: string;
    tooltipDisabled?: boolean;
  };

/** Returns the canonical classes for a button-like element. */
export function buttonClasses(options: ButtonClassOptions = {}): string {
  const {
    variant,
    size,
    fullWidth = false,
    noTouchResize = false,
    square = false,
    class: className,
  } = options;

  return cn(
    buttonVariants({ variant, size }),
    fullWidth && 'w-full',
    !noTouchResize && BUTTON_TOUCH_STYLES,
    square && 'aspect-square p-0',
    className
  );
}

function isIconSize(size: ButtonSize): boolean {
  return size.startsWith('icon-');
}

export const Button = (props: ButtonProps) => {
  const [local, others] = splitProps(props, [
    'tooltipPlacement',
    'children',
    'tooltip',
    'variant',
    'hotkey',
    'shortcut',
    'class',
    'depth',
    'label',
    'size',
    'fullWidth',
    'noTouchResize',
    'square',
    'tooltipDisabled',
    'aria-label',
  ]);

  const group = useButtonGroupContext();

  const variant = () => local.variant ?? group?.variant ?? 'ghost';
  const size = () => local.size ?? group?.size ?? 'md';

  const cls = () =>
    buttonClasses({
      variant: variant(),
      size: size(),
      fullWidth: local.fullWidth,
      noTouchResize: local.noTouchResize,
      square: local.square,
      class: local.class,
    });

  const placement = () => local.tooltipPlacement ?? 'bottom';

  const accessibleLabel = () =>
    local['aria-label'] ??
    local.label ??
    (isIconSize(size()) || local.square ? local.tooltip : undefined);

  const button = () => (
    <KobalteButton
      data-button
      data-slot="button"
      data-variant={variant()}
      data-size={size()}
      class={cls()}
      aria-label={accessibleLabel()}
      {...others}
    >
      {local.children}
    </KobalteButton>
  );

  const tooltipLabel = () => local.tooltip ?? local.label;

  // Skip Layer when inside a ButtonGroup (the group already provides one)
  // unless the button has its own explicit depth
  const skipLayer = () => group !== undefined && local.depth === undefined;

  const content = () => (
    <Show
      when={tooltipLabel() !== undefined ? tooltipLabel() : false}
      fallback={button()}
    >
      {(label) => (
        <Tooltip
          class={local.fullWidth ? 'w-full' : undefined}
          hotkey={local.hotkey}
          shortcut={local.shortcut}
          placement={placement()}
          label={label()}
          disabled={local.tooltipDisabled}
        >
          {button()}
        </Tooltip>
      )}
    </Show>
  );

  return (
    <Show
      when={skipLayer()}
      fallback={<Layer depth={local.depth ?? 0}>{content()}</Layer>}
    >
      {content()}
    </Show>
  );
};
