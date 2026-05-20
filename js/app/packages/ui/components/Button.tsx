import { Button as KobalteButton, type ButtonRootProps } from '@kobalte/core/button';
import { type ComponentProps, type JSX, Show, splitProps } from 'solid-js';
import { Tooltip } from './Tooltip';
import type { HotkeyToken } from '@core/hotkey/tokens';
import type { Placement } from '@floating-ui/dom';
import { cn } from '../utils/classname';
import { useButtonGroupContext } from './ButtonGroup';
import { Layer } from './Layer';

export type ButtonProps = ButtonRootProps<'button'> & ComponentProps<'button'> & {
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  tooltipPlacement?: Placement;
  noTouchResize?: boolean;
  variant?: ButtonVariant;
  children?: JSX.Element;
  tooltip?: string;
  label?: string;
  hotkey?: HotkeyToken | HotkeyToken[];
  /**
   * Raw shortcut string(s) shown in the tooltip when no `hotkey` token is available.
   */
  shortcut?: string | string[];
  size?: ButtonSize;
  class?: string;
};

export type ButtonSize = 'sm' | 'icon-sm' | 'md' | 'icon-md' | 'lg' | 'icon-lg';

export type ButtonVariant = 'ghost' | 'base' | 'active' | 'danger' | 'cta';

const variantStyles: Record<ButtonVariant, string> = {
  danger:           'bg-transparent text-failure    border border-failure/50 not-disabled:hover:bg-failure/10 not-disabled:active:bg-failure/20                   disabled:opacity-30 ',
  base:             'bg-transparent text-ink-muted  border border-edge-muted not-disabled:hover:bg-hover      not-disabled:hover:text-ink        active:bg-active disabled:opacity-30 ',
  active:           'bg-accent-bg   text-accent     border border-accent                                                                                      disabled:opacity-30 ',
  ghost:            'bg-transparent text-ink-muted                           not-disabled:hover:bg-hover      not-disabled:hover:text-ink        active:bg-active disabled:opacity-30 ',
  'cta': 'bg-accent      text-surface    border border-transparent not-disabled:hover:bg-accent/90                                  active:bg-accent/80 disabled:opacity-30 ',
};

const sizeStyles: Record<ButtonSize, string> = {
  'lg':      '          p-2.5  [&_:where(svg)]:size-5 gap-2   text-base',
  'md':      '          p-2                           gap-1.5 text-sm  ', /* scuffed */
  'sm':      'h-6       px-2   [&_:where(svg)]:size-4 gap-1   text-xs  ',
  'icon-lg': 'size-11   p-2    [&_:where(svg)]:size-7                  ', /* unused */
  'icon-md': 'size-9    p-1.5  [&_:where(svg)]:size-6                  ',
  'icon-sm': 'size-6    p-0.5  [&_:where(svg)]:size-5                  ',
};

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
  ]);

  const group = useButtonGroupContext();

  const cls = () =>
    cn(
      'relative inline-flex items-center justify-center font-medium leading-none border border-transparent rounded-sm whitespace-nowrap',
      { 'touch:min-h-9 touch:min-w-9 touch:[&_svg]:size-6': !(props.noTouchResize) },
      'outline-none focus-visible:bg-active',
      'data-disabled:cursor-not-allowed',
      variantStyles[local.variant ?? group?.variant ?? 'ghost'],
      sizeStyles[local.size ?? group?.size ?? 'md'],
      local.class
    );

  const placement = () => local.tooltipPlacement ?? 'bottom';

  const variantStyle = (): JSX.CSSProperties | string | undefined => {
    const variant = local.variant ?? group?.variant;
    if (variant === 'cta') {
      return {
        '--color-edge': 'var(--color-surface)',
        '--color-edge-muted': 'oklch(from var(--color-surface) l c h / 0.5)',
      };
    }
    return others.style;
  };

  const button = () => (
    <KobalteButton data-button class={cls()} {...others} style={variantStyle()}>
      {local.children}
    </KobalteButton>
  );

  const tooltipLabel = () => local.label ?? local.tooltip;

  // Skip Layer when inside a ButtonGroup (the group already provides one)
  // unless the button has its own explicit depth
  const skipLayer = () => group !== undefined && local.depth === undefined;

  const content = () => (
    <Show when={tooltipLabel() !== undefined ? tooltipLabel() : false} fallback={button()}>
      {(label) => (
        <Tooltip
          hotkey={local.hotkey}
          shortcut={local.shortcut}
          placement={placement()}
          label={label()}
        >
          {button()}
        </Tooltip>
      )}
    </Show>
  );

  return (
    <Show when={skipLayer()} fallback={<Layer depth={local.depth ?? 0}>{content()}</Layer>}>
      {content()}
    </Show>
  );
};
