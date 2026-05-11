import { Button as KobalteButton, type ButtonRootProps } from '@kobalte/core/button';
import { type ComponentProps, type JSX, Show, splitProps } from 'solid-js';
import type { Placement } from '@floating-ui/dom';
import CorvuTooltip from '@corvu/tooltip';
import { cn } from '../utils/classname';
import { Layer } from './Layer';

export type ButtonProps = ButtonRootProps<'button'> & ComponentProps<'button'> & {
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  tooltipPlacement?: Placement;
  variant?: ButtonVariant;
  children?: JSX.Element;
  tooltip?: JSX.Element;
  size?: ButtonSize;
  class?: string;
  noTouchResize?: boolean;
};

type ButtonSize = 'sm' | 'icon-sm' | 'md' | 'icon-md' | 'lg' | 'icon-lg';

type ButtonVariant = 'ghost' | 'base' | 'active' | 'danger';

const variantStyles: Record<ButtonVariant, string> = {
  danger: 'bg-transparent text-failure    border border-failure/50 not-disabled:hover:bg-failure/10 not-disabled:active:bg-failure/20                   disabled:opacity-30 ',
  base:   'bg-transparent text-ink-muted  border border-edge-muted not-disabled:hover:bg-hover      not-disabled:hover:text-ink        active:bg-active disabled:opacity-30 ',
  active: 'bg-accent-bg   text-accent     border border-accent-ink                                                                                      disabled:opacity-30 ',
  ghost:  'bg-transparent text-ink-muted                           not-disabled:hover:bg-hover      not-disabled:hover:text-ink        active:bg-active disabled:opacity-30 ',
};

const sizeStyles: Record<ButtonSize, string> = {
  'lg':      '          p-2.5  [&_svg]:size-5 gap-2   text-base',
  'md':      '          p-2                   gap-1.5 text-sm  ', /* scuffed */
  'sm':      'h-6       px-2   [&_svg]:size-4 gap-1   text-xs  ',
  'icon-lg': 'size-11   p-2    [&_svg]:size-7                  ', /* unused */
  'icon-md': 'size-9    p-1.5  [&_svg]:size-6                  ',
  'icon-sm': 'size-6    p-1    [&_svg]:size-4                  ',
};

export const Button = (props: ButtonProps) => {
  const [local, others] = splitProps(props, [
    'tooltipPlacement',
    'children',
    'variant',
    'tooltip',
    'class',
    'depth',
    'size',
  ]);

  const cls = () =>
    cn(
      'relative inline-flex items-center justify-center font-medium leading-none border border-transparent rounded-sm whitespace-nowrap',
      { 'touch:min-h-9 touch:min-w-9 touch:[&_svg]:size-6': !(props.noTouchResize) },
      'outline-none focus-visible:bg-active',
      'data-disabled:cursor-not-allowed',
      variantStyles[local.variant ?? 'ghost'],
      sizeStyles[local.size ?? 'md'],
      local.class
    );

  return (
    <Layer depth={local.depth ?? 0}>
      <Show
        fallback={
          <KobalteButton class={cls()} {...others}>
            {local.children}
          </KobalteButton>
        }
        when={local.tooltip}
      >
        <CorvuTooltip
          placement={local.tooltipPlacement ?? 'bottom'}
          floatingOptions={{
            size: { padding: 16, fitViewPort: true },
            shift: { padding: 16 },
            offset: 12,
            flip: true,
          }}
          group="tooltip-single-group"
          closeDelay={250}
          openDelay={250}
        >
          <CorvuTooltip.Trigger as={KobalteButton} class={cls()} {...others}>
            {local.children}
          </CorvuTooltip.Trigger>
          <CorvuTooltip.Portal>
            <CorvuTooltip.Content
              style={{ 'max-width': 'calc(100vw - 32px)' }}
              class="z-tool-tip"
            >
              <Layer depth={3}>
              <div class="border border-edge bg-panel flex items-center justify-center p-1.5 text-ink-muted text-xs wrap-break-word rounded-sm shadow-md shadow-[#000]/5">
                {local.tooltip}
              </div>
              </Layer>
            </CorvuTooltip.Content>
          </CorvuTooltip.Portal>
        </CorvuTooltip>
      </Show>
    </Layer>
  );
};
