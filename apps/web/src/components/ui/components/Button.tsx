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

// Text actions use flat frames. Icon actions and embedded controls remain
// unframed; navigation keeps its independent quiet selection treatment.
/** Canonical variant classes for buttons and button-like elements. */
export const buttonVariants = createVariants(
  cn(
    'relative inline-flex shrink-0 items-center justify-center whitespace-nowrap text-sm',
    'rounded-full border border-edge-button bg-control text-ink-muted font-medium outline-none select-none transition-colors duration-120 motion-reduce:transition-none [&_*]:select-none',
    'not-touch:not-disabled:hover:overlay-hover not-touch:not-disabled:hover:text-ink not-disabled:active:overlay-active',
    'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-edge-focus',
    'aria-pressed:overlay-active aria-pressed:text-ink',
    'data-disabled:cursor-not-allowed data-disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0'
  ),
  {
    variant: {
      danger:
        'text-failure not-touch:not-disabled:hover:text-failure aria-pressed:text-failure',
      outline: '',
      accent: 'text-ink font-semibold',
      success:
        'text-success not-touch:not-disabled:hover:text-success aria-pressed:text-success',
      // Retained for existing callers; ordinary actions always have a frame.
      ghost: '',
      plain: 'border-0 bg-transparent',
      strong: 'text-ink font-semibold',
      cta: 'text-ink font-semibold',
      navigation: 'border-transparent bg-transparent',
    },
    size: {
      xs: "h-5 gap-1 px-1 text-xs [&>svg:not([class*='size-'])]:size-3",
      'icon-xs': "size-5 p-0.5 [&>svg:not([class*='size-'])]:size-3",
      sm: CONTROL_SIZE_VARIANTS.sm,
      md: CONTROL_SIZE_VARIANTS.md,
      lg: CONTROL_SIZE_VARIANTS.lg,
      xl: "h-12 gap-2 px-4 text-base [&>svg:not([class*='size-'])]:size-5",
      'icon-lg':
        "size-9 aspect-square rounded-xl p-2 [&>svg:not([class*='size-'])]:size-5",
      'icon-md':
        "size-8 aspect-square p-1.5 [&>svg:not([class*='size-'])]:size-4",
      'icon-sm':
        "size-6 aspect-square p-1 [&>svg:not([class*='size-'])]:size-3.5",
      'icon-composer':
        'size-6 aspect-square p-1 touch:[&_svg]:size-3.5 not-touch:size-[33.75px] not-touch:p-[3.75px] not-touch:[&_svg]:size-[20.625px]',
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
    (isIconSize(size ?? 'md') || square) && 'border-0 bg-transparent',
    fullWidth && 'w-full',
    !noTouchResize && BUTTON_TOUCH_STYLES,
    square && 'aspect-square p-0',
    className
  );
}

function isIconSize(size: ButtonSize): boolean {
  return size.startsWith('icon-');
}

/**
 * The standard way to trigger an action. `variant` carries emphasis and
 * `size` carries density; both are shared with Badge so button-like elements
 * line up.
 *
 * @do Use icon sizes (or square) for borderless icon actions.
 * @do Use plain for embedded controls such as the composer agent picker.
 * @do Use strong ink/weight for primary text actions on the flat frame.
 * @do Use `navigation` only for selectable navigation or list rows.
 * @do Always set `label` on icon-only buttons; it is the accessible name.
 * @do Use `danger` only for destructive actions, paired with a confirmation.
 * @dont Do not restyle a button with utility classes when a variant already
 *   covers it.
 * @dont Do not use a Button for navigation that should be a link.
 * @dont Do not put two `danger` buttons next to each other.
 */
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
    cn(
      buttonClasses({
        variant: variant(),
        size: size(),
        fullWidth: local.fullWidth,
        noTouchResize: local.noTouchResize,
        square: local.square,
      }),
      group && 'bg-transparent',
      local.class
    );

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
