import { Button, cn } from '@ui';
import type { JSX, Ref } from 'solid-js';

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
}) {
  return (
    <Button
      ref={props.ref}
      variant="ghost"
      size="md"
      data-header-action
      aria-label={props.label}
      tooltip={props.tooltip}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-busy={props.busy}
      class={cn(
        '@max-[600px]/split-header:w-8 @max-[600px]/split-header:p-0',
        props.class
      )}
    >
      {props.icon}
      <span data-header-action-label class="@max-[600px]/split-header:hidden">
        {props.label}
      </span>
    </Button>
  );
}
