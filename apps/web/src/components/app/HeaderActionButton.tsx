import { Button } from '@ui';
import type { JSX } from 'solid-js';

/** Shared geometry for labeled actions in a block's header. */
export function HeaderActionButton(props: {
  label: string;
  icon: JSX.Element;
  onClick: () => void;
  tooltip?: string;
}) {
  return (
    <Button
      variant="ghost"
      size="md"
      aria-label={props.label}
      tooltip={props.tooltip}
      onClick={props.onClick}
      class="@max-[600px]/split-header:w-8 @max-[600px]/split-header:p-0"
    >
      {props.icon}
      <span class="@max-[600px]/split-header:hidden">{props.label}</span>
    </Button>
  );
}
