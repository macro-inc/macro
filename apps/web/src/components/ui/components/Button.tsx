import type { HotkeyToken } from '@core/hotkey/tokens';
import {
  type ButtonRootProps,
  Button as KobalteButton,
} from '@kobalte/core/button';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import {
  type ComponentProps,
  For,
  type JSX,
  Show,
  splitProps,
  type ValidComponent,
} from 'solid-js';
import { createButtonActivation } from '../utils/button-activation';
import { raisedButtonStyles } from '../utils/button-finishes';
import { cn } from '../utils/classname';
import { iconControlSizes, labeledControlSizes } from '../utils/control-sizes';
import { createVariants, type VariantProps } from '../utils/variants';
import { Hotkey } from './Hotkey';
import { Tooltip } from './Tooltip';

const buttonFrames = {
  primary:
    'bg-button-primary-bg text-button-primary-ink border-transparent shadow-button',
  accent:
    'bg-button-accent-bg text-button-accent-ink border-transparent shadow-button',
  secondary: cn(
    'bg-button-secondary-bg text-ink-muted border-border-secondary dark-mode:border-transparent shadow-button',
    'light-mode:not-data-disabled:active:border-border-secondary light-mode:aria-pressed:border-border-secondary light-mode:popup-open:border-border-secondary'
  ),
  outline:
    'bg-transparent text-ink-muted border-border-secondary bg-none shadow-none',
  ghost:
    'bg-button-tertiary-bg text-ink-muted border-transparent bg-none shadow-none',
  danger: 'bg-button-danger-bg text-failure border-transparent shadow-button',
  'danger-ghost':
    'bg-button-tertiary-bg text-failure border-transparent bg-none shadow-none',
  success: 'bg-button-success-bg text-success border-transparent shadow-button',
  link: 'border-transparent bg-transparent text-link shadow-none',
};

const buttonMutedTextStyles =
  'not-data-disabled:hover:text-ink not-data-disabled:focus-visible:text-ink not-data-disabled:active:text-ink aria-pressed:text-ink popup-open:text-ink';
// Disclosure state stays semantic; only open popups receive active styling.
const buttonPressedStyles =
  'not-data-disabled:active:bg-none aria-pressed:bg-none popup-open:bg-none not-data-disabled:active:shadow-none aria-pressed:shadow-none popup-open:shadow-none';

/** Shared recipe for Button and headless controls that own their rendering. */
const buttonStyles = createVariants(
  'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full border font-medium select-none transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 data-disabled:cursor-not-allowed data-disabled:opacity-45 focus-visible:outline-hidden focus-visible:-outline-offset-2 motion-reduce:transition-none forced-colors:focus-visible:outline-current touch:min-h-9 touch:min-w-9',
  {
    variant: {
      primary: cn(
        buttonFrames.primary,
        'not-data-disabled:hover:bg-button-primary-hover not-data-disabled:active:bg-button-primary-pressed aria-pressed:bg-button-primary-pressed aria-pressed:not-data-disabled:hover:bg-button-primary-pressed popup-open:bg-button-primary-pressed popup-open:not-data-disabled:hover:bg-button-primary-pressed',
        buttonPressedStyles
      ),
      accent: cn(
        buttonFrames.accent,
        'not-data-disabled:hover:bg-button-accent-hover not-data-disabled:active:bg-button-accent-pressed aria-pressed:bg-button-accent-pressed aria-pressed:not-data-disabled:hover:bg-button-accent-pressed popup-open:bg-button-accent-pressed popup-open:not-data-disabled:hover:bg-button-accent-pressed',
        buttonPressedStyles
      ),
      secondary: cn(
        buttonFrames.secondary,
        buttonMutedTextStyles,
        'not-data-disabled:hover:bg-button-secondary-hover not-data-disabled:active:bg-button-secondary-pressed aria-pressed:bg-button-secondary-pressed aria-pressed:not-data-disabled:hover:bg-button-secondary-pressed popup-open:bg-button-secondary-pressed popup-open:not-data-disabled:hover:bg-button-secondary-pressed',
        buttonPressedStyles
      ),
      outline: cn(
        buttonFrames.outline,
        buttonMutedTextStyles,
        'not-data-disabled:hover:bg-button-outline-hover not-data-disabled:active:bg-button-outline-pressed aria-pressed:bg-button-outline-pressed aria-pressed:not-data-disabled:hover:bg-button-outline-pressed popup-open:bg-button-outline-pressed popup-open:not-data-disabled:hover:bg-button-outline-pressed',
        buttonPressedStyles
      ),
      ghost: cn(
        buttonFrames.ghost,
        'not-data-disabled:hover:bg-button-tertiary-hover not-data-disabled:hover:text-ink not-data-disabled:active:bg-button-tertiary-pressed not-data-disabled:active:text-ink aria-pressed:bg-button-tertiary-pressed aria-pressed:text-ink aria-pressed:not-data-disabled:hover:bg-button-tertiary-pressed popup-open:bg-button-tertiary-pressed popup-open:text-ink popup-open:not-data-disabled:hover:bg-button-tertiary-pressed',
        buttonPressedStyles
      ),
      danger: cn(
        buttonFrames.danger,
        'not-data-disabled:hover:bg-button-danger-hover not-data-disabled:active:bg-button-danger-pressed aria-pressed:bg-button-danger-pressed aria-pressed:not-data-disabled:hover:bg-button-danger-pressed popup-open:bg-button-danger-pressed popup-open:not-data-disabled:hover:bg-button-danger-pressed',
        buttonPressedStyles
      ),
      'danger-ghost': cn(
        buttonFrames['danger-ghost'],
        'not-data-disabled:hover:bg-button-danger-hover not-data-disabled:active:bg-button-danger-pressed aria-pressed:bg-button-danger-pressed aria-pressed:not-data-disabled:hover:bg-button-danger-pressed popup-open:bg-button-danger-pressed popup-open:not-data-disabled:hover:bg-button-danger-pressed',
        buttonPressedStyles
      ),
      success: cn(
        buttonFrames.success,
        'not-data-disabled:hover:bg-button-success-hover not-data-disabled:active:bg-button-success-pressed aria-pressed:bg-button-success-pressed aria-pressed:not-data-disabled:hover:bg-button-success-pressed popup-open:bg-button-success-pressed popup-open:not-data-disabled:hover:bg-button-success-pressed',
        buttonPressedStyles
      ),
      link: cn(
        buttonFrames.link,
        'underline-offset-4 not-data-disabled:hover:text-link-hover not-data-disabled:hover:underline'
      ),
    },
    size: {
      ...labeledControlSizes,
      'icon-xs': iconControlSizes.xs,
      'icon-sm': iconControlSizes.sm,
      'icon-md': iconControlSizes.md,
      'icon-lg': iconControlSizes.lg,
      'icon-xl': iconControlSizes.xl,
    },
  },
  { variant: 'primary', size: 'md' }
);

export type ButtonVariantProps = VariantProps<typeof buttonStyles>;
export type ButtonVariant = NonNullable<ButtonVariantProps['variant']>;
export type ButtonSize = NonNullable<ButtonVariantProps['size']>;
export type ButtonFinish = 'flat' | 'raised';
export type ButtonClassOptions = {
  variant?: ButtonVariant;
  /** Composed rows own their surface states without layering a second button face. */
  appearance?: 'default' | 'bare';
  /** Outline is always flat; other framed variants adapt to desktop and touch. */
  finish?: ButtonFinish;
  size?: ButtonSize;
  fullWidth?: boolean;
  class?: string;
};

function buttonFinishClasses(variant: ButtonVariant, finish?: ButtonFinish) {
  if (finish === 'flat' || variant === 'outline') return 'shadow-none';
  if (
    finish !== 'raised' &&
    (variant === 'ghost' || variant === 'danger-ghost' || variant === 'link')
  ) {
    return undefined;
  }

  return raisedButtonStyles;
}

/** Non-interactive frame material shared by Button and ButtonGroup. */
export function buttonFrameClasses(
  options: Pick<ButtonClassOptions, 'variant' | 'finish'> = {}
) {
  const { variant = 'primary', finish } = options;
  return cn(buttonFrames[variant], buttonFinishClasses(variant, finish));
}

export function buttonClasses(options: ButtonClassOptions = {}) {
  const { variant = 'primary', finish, appearance } = options;
  const isBare = appearance === 'bare';

  return cn(
    buttonStyles({ variant: isBare ? null : variant, size: options.size }),
    isBare && 'border-transparent bg-transparent shadow-none',
    !isBare && buttonFinishClasses(variant, finish),
    options.fullWidth && 'w-full',
    options.class
  );
}

export const buttonVariants = buttonClasses;

export type ButtonTooltipOptions = {
  content: JSX.Element;
  placement?: ComponentProps<typeof Tooltip.Root>['placement'];
  disabled?: boolean;
  hotkey?: HotkeyToken | HotkeyToken[];
  shortcut?: string | string[];
};
export type ButtonTooltip = string | ButtonTooltipOptions;

function tooltipOptions(
  value: ButtonTooltip | undefined
): ButtonTooltipOptions {
  if (typeof value === 'string' || value === undefined) {
    return { content: value };
  }
  return value;
}

export type ButtonProps<T extends ValidComponent = 'button'> = PolymorphicProps<
  T,
  ButtonRootProps<T> &
    ButtonClassOptions & {
      /** Plain text or tooltip options; accessible naming stays in aria-label. */
      tooltip?: ButtonTooltip;
      loading?: boolean;
      children?: JSX.Element;
    }
>;

/**
 * Actions use Button; navigation uses anchors. Framed variants adapt to the device.
 * @do Use primary for solid neutral emphasis and accent for explicit theme-color emphasis.
 * @do Set aria-label for icon-only actions and use an explicit icon-* size.
 * @do Use tooltip strings for content only, or options for hotkeys and placement.
 * @dont Use Button for links or size descendant icons through the control.
 */
export function Button<T extends ValidComponent = 'button'>(
  props: ButtonProps<T>
) {
  const [local, native] = splitProps(props as ButtonProps, [
    'variant',
    'appearance',
    'finish',
    'size',
    'loading',
    'class',
    'children',
    'disabled',
    'fullWidth',
    'tooltip',
    'tabIndex',
    'onClick',
    'onAuxClick',
    'onKeyDown',
    'onKeyUp',
  ]);
  const variant = () => local.variant ?? 'primary';
  const size = () => local.size ?? 'md';
  const unavailable = () => !!(local.disabled || local.loading);
  const activation = createButtonActivation(unavailable, local);
  const tabIndexProps = () => {
    if (unavailable()) return { tabIndex: -1 };
    if (local.tabIndex === undefined) return {};
    return { tabIndex: local.tabIndex };
  };
  const tooltip = () => tooltipOptions(local.tooltip);
  const tokens = () => {
    const value = tooltip().hotkey;
    return value ? (Array.isArray(value) ? value : [value]) : [];
  };
  const shortcuts = () => {
    const value = tooltip().shortcut;
    return value ? (Array.isArray(value) ? value : [value]) : [];
  };

  const Control = (buttonProps: ComponentProps<typeof KobalteButton>) => {
    return (
      <KobalteButton
        {...buttonProps}
        as={buttonProps.as ?? 'button'}
        data-button=""
        data-slot="button"
        data-size={size()}
        data-variant={variant()}
        data-appearance={local.appearance ?? 'default'}
        disabled={unavailable()}
        {...tabIndexProps()}
        aria-busy={local.loading || buttonProps['aria-busy'] || undefined}
        class={buttonClasses({
          ...local,
          variant: variant(),
          size: size(),
          class: local.class,
        })}
        {...activation}
      >
        <Show when={local.loading !== undefined} fallback={local.children}>
          <span
            class={cn(
              'inline-flex min-w-0 flex-1 items-center [gap:inherit] [justify-content:inherit]',
              local.loading && 'opacity-0'
            )}
          >
            {local.children}
          </span>
        </Show>
        <Show when={local.loading}>
          <span
            aria-hidden="true"
            class="absolute size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
          />
        </Show>
      </KobalteButton>
    );
  };

  return (
    <Show when={local.tooltip != null} fallback={<Control {...native} />}>
      <Tooltip.Root
        disabled={tooltip().disabled}
        placement={tooltip().placement}
      >
        <Control
          {...native}
          as={(triggerProps: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
            <Tooltip.Trigger {...triggerProps} as={native.as ?? 'button'} />
          )}
        />
        <Tooltip.Portal>
          <Tooltip.Content>
            <div class="flex items-center gap-2">
              <div class="min-w-0">{tooltip().content}</div>
              <For each={tokens()}>
                {(token, index) => (
                  <>
                    <Show when={index() > 0}>
                      <span class="text-ink-muted">then</span>
                    </Show>
                    <Hotkey token={token} theme="subtle" />
                  </>
                )}
              </For>
              <For each={shortcuts()}>
                {(shortcut, index) => (
                  <>
                    <Show when={index() > 0}>
                      <span class="text-ink-muted">then</span>
                    </Show>
                    <Hotkey shortcut={shortcut} theme="subtle" />
                  </>
                )}
              </For>
            </div>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Show>
  );
}
