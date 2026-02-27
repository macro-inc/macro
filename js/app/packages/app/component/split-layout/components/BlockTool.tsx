import { Button } from '@ui/components/Button';
import { cn } from '@ui/utils/classname';
import type { Component, JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export type BlockTool = {
  label: string | (() => string);
  icon: Component;
  action: () => void;
  condition?: () => boolean;
  isActive?: () => boolean;
  buttonComponent?: () => JSX.Element;
  divideAbove?: boolean;
};

export function ToolButton(props: { tool: BlockTool }) {
  return (
    <Button
      onClick={props.tool.action}
      tooltip={
        typeof props.tool.label === 'function'
          ? props.tool.label()
          : props.tool.label
      }
      class={cn(
        'px-1',
        props.tool.isActive?.() &&
          'bg-accent/20 hover:bg-accent/30 text-accent-ink'
      )}
    >
      <Dynamic
        component={
          props.tool.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
        }
        class="size-4 shrink-0"
      />
    </Button>
  );
}
