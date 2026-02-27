import CaretDown from '@phosphor-icons/core/regular/caret-down.svg';
import { cn } from '@ui/utils/classname';
import { Tooltip } from 'core/component/Tooltip';
import { type JSX, type ParentComponent, Show, splitProps } from 'solid-js';

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'destructive';
  tooltip?: JSX.Element;
  showChevron?: boolean;
  suppressInteractionStyling?: boolean;
};

/**
 * ### The basic button component. When in doubt, use Button.
 *
 * @param props.variant - Primary, secondary, tertiary (aka the default), or destructive.
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
 *   class="aspect-square"
 *   tooltip={<LabelAndHotKey label="Save" shortcut='cmd+s' />}
 * >
 *   <EntityIcon targetType="pdf" theme='monochrome' size="md" />
 * </Button>
 *
 */
export const Button: ParentComponent<ButtonProps> = (props) => {
  const [local, buttonAttributes] = splitProps(props, [
    'variant',
    'class',
    'children',
    'tooltip',
    'showChevron',
    'suppressInteractionStyling',
    'type',
  ]);

  function MaybeWrapInTooltip(props: { children: JSX.Element }) {
    if (!local.tooltip) return props.children;

    return <Tooltip tooltip={local.tooltip}>{props.children}</Tooltip>;
  }

  return (
    <MaybeWrapInTooltip>
      <button
        type={local.type ?? 'button'}
        class={cn(
          'relative flex items-center justify-center gap-[1ch] px-[1ch] py-[0.25lh] border border-transparent',
          'font-mono font-medium uppercase leading-none',
          !local.suppressInteractionStyling &&
            'hover:bg-hover focus:[--focus-border-inset:-4px] active:border-accent active:bg-accent active:text-panel disabled:opacity-50 disabled:hover:bg-inherit',
          'touch:min-h-11 touch:min-w-11 touch:[&_svg]:size-6',

          {
            'bg-ink border-ink text-panel hover:bg-accent hover:opacity-80 active:opacity-100':
              'primary' === local.variant,
            'border-ink': 'secondary' === local.variant,
            'border-failure text-failure active:bg-failure hover:bg-failure-bg':
              'destructive' === local.variant,
            'p-0 gap-0 items-stretch': local.showChevron,
          },
          // Anything added by the caller will granularly override
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
