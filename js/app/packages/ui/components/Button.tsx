import { Button as KButton, type ButtonRootProps } from '@kobalte/core/button';
import { type JSX, Show, splitProps, type ValidComponent } from 'solid-js';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import type { Placement } from '@floating-ui/dom';
import CorvuTooltip from '@corvu/tooltip';
import { cn } from '../utils/classname';
import { Layer } from './Layer';

type ButtonProps<T extends ValidComponent = 'button'> = PolymorphicProps<T, ButtonRootProps<T>> & {
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  tooltipPlacement?: Placement;
  variant?: ButtonVariant;
  children?: JSX.Element;
  tooltip?: JSX.Element;
  size?: ButtonSize;
  class?: string;
};

type ButtonVariant = 'destructive' | 'secondary' | 'active' | 'ghost' | 'link';

type ButtonSize = 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon-md' | 'icon-lg';

const variantStyles: Record<ButtonVariant, string> = {
  destructive: 'bg-transparent text-failure    border border-failure/50     not-disabled:hover:bg-failure/10   not-disabled:active:bg-failure/20                              disabled:opacity-50          ',
  secondary:   'bg-transparent text-ink        border border-edge           not-disabled:hover:bg-ink/10       not-disabled:active:bg-ink/12                                  disabled:opacity-30          ',
  active:      'bg-accent-bg   text-accent     border border-accent-ink                                                                                                                                    ',
  ghost:       'bg-transparent text-ink-muted                               not-disabled:hover:bg-ink/10       not-disabled:active:bg-ink/12      not-disabled:hover:text-ink disabled:opacity-30          ',
  link:        'bg-transparent text-accent     underline-offset-2           not-disabled:hover:underline       not-disabled:active:text-accent/80                             disabled:text-ink-extra-muted',
};

const sizeStyles: Record<ButtonSize, string> = {
  'icon-lg': 'p-2   size-11 [&_svg]:size-7',
  'icon-md': 'p-1.5 size-9  [&_svg]:size-6',
  'icon-sm': 'p-1   size-7  [&_svg]:size-5',

  'lg': 'p-2.5 text-base gap-2  ',
  'md': 'p-2   text-sm   gap-1.5',
  'sm': 'p-1   text-xs   gap-1  ',
};

const TOOLTIP_DELAY = 250;

export const Button = <T extends ValidComponent = 'button'>(
  props: ButtonProps<T>
) => {
  const [local, others] = splitProps(props as ButtonProps<'button'>, [
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
      'relative inline-flex items-center justify-center font-medium leading-none border border-transparent rounded-xs',
      'touch:min-h-11 touch:min-w-11 touch:[&_svg]:size-6',
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
          <KButton class={cls()} {...others}>
            {local.children}
          </KButton>
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
          closeDelay={TOOLTIP_DELAY}
          openDelay={TOOLTIP_DELAY}
        >
          <CorvuTooltip.Trigger as={KButton} class={cls()} {...others}>
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
