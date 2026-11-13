import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Button, ButtonGroup, cn } from '@ui';
import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { BlockTool } from './block-tool';

/** A block tool as an icon button, alone or as a segment of a header group. */
export function ToolButton(props: { tool: BlockTool; grouped?: boolean }) {
  const label = () =>
    typeof props.tool.label === 'function'
      ? props.tool.label()
      : props.tool.label;

  const Control = props.grouped ? ButtonGroup.Button : Button;
  return (
    <Control
      variant="ghost"
      aria-label={label()}
      tooltip={{ content: label(), hotkey: props.tool.hotkeyToken }}
      onClick={props.tool.action}
      class={cn(
        'px-1',
        props.tool.isActive?.() && 'bg-accent/20 hover:bg-accent/30 text-accent'
      )}
      size={isTouchDevice() || props.grouped ? 'icon-sm' : 'icon-md'}
    >
      <Dynamic
        component={
          props.tool.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
        }
        class="size-4 shrink-0 touch:size-3.5"
      />
    </Control>
  );
}
