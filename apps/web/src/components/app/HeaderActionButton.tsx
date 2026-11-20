import { Button, ButtonGroup, type ButtonSize, CountBadge, cn } from '@ui';
import { type JSX, type Ref, Show } from 'solid-js';

const LABELED_SIZES: Partial<Record<ButtonSize, ButtonSize>> = {
  'icon-xs': 'xs',
  'icon-sm': 'sm',
  'icon-md': 'md',
  'icon-lg': 'lg',
  'icon-xl': 'xl',
};

/** Shared geometry for labeled actions in a block's header. */
export function HeaderActionButton(props: {
  ref?: Ref<HTMLButtonElement>;
  label: string;
  icon: JSX.Element;
  onClick: () => void;
  tooltip?: string;
  disabled?: boolean;
  busy?: boolean;
  class?: string;
  grouped?: boolean;
  size?: ButtonSize;
  /** Shown after the label, and after the icon once narrow headers hide it. */
  count?: number;
  /** What `count` counts, added to the accessible name while it shows. */
  countLabel?: string;
}) {
  const Control = props.grouped ? ButtonGroup.Button : Button;
  const iconOnly = () => props.size?.startsWith('icon-') ?? false;
  const counted = () => (props.count ?? 0) > 0;
  const size = () => {
    const requested = props.size ?? (props.grouped ? undefined : 'md');
    if (!counted() || !requested) return requested;
    return LABELED_SIZES[requested] ?? requested;
  };
  const accessibleLabel = () =>
    counted() && props.countLabel
      ? `${props.label}, ${props.countLabel}`
      : props.label;
  return (
    <Control
      ref={props.ref}
      variant="ghost"
      size={size()}
      data-header-action
      aria-label={accessibleLabel()}
      tooltip={props.tooltip}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-busy={props.busy}
      class={cn(
        !iconOnly() && 'px-2',
        !iconOnly() && !counted() && '@max-[600px]/split-header:p-0',
        !iconOnly() &&
          !counted() &&
          (props.grouped && props.size !== 'md'
            ? '@max-[600px]/split-header:w-7'
            : '@max-[600px]/split-header:w-8'),
        props.class
      )}
    >
      {props.icon}
      <Show when={!iconOnly()}>
        <span data-header-action-label class="@max-[600px]/split-header:hidden">
          {props.label}
        </span>
      </Show>
      <CountBadge count={props.count ?? 0} />
    </Control>
  );
}
