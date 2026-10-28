import { Button, ButtonGroup, type ButtonSize, cn } from '@ui';
import { type JSX, type Ref, Show } from 'solid-js';

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
}) {
  const Control = props.grouped ? ButtonGroup.Button : Button;
  const iconOnly = () => props.size?.startsWith('icon-') ?? false;
  return (
    <Control
      ref={props.ref}
      variant="ghost"
      size={props.size ?? (props.grouped ? undefined : 'md')}
      data-header-action
      aria-label={props.label}
      tooltip={props.tooltip}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-busy={props.busy}
      class={cn(
        !iconOnly() && 'px-2 @max-[600px]/split-header:p-0',
        !iconOnly() &&
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
    </Control>
  );
}
