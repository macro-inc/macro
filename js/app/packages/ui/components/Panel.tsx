import { cn } from '@ui/utils/classname';
import type { JSX } from 'solid-js';

export type PanelProps = {
  highlightColor?: string;
  children?: JSX.Element;
  active?: boolean;
  class?: string;
};

export function Panel(props: PanelProps) {
  return (
    <div
      style={{
        'background-image': `linear-gradient(${props.active ? `${props.highlightColor || 'var(--color-accent)'}, var(--color-edge-muted) 80%` : 'var(--color-edge-muted)'})`,
      }}
      class="p-px h-full w-full box-border rounded-md overflow-clip min-h-0"
    >
      <div
        class={cn(
          'h-full w-full box-border bg-panel rounded-[5px] overflow-clip',
          props.class
        )}
      >
        {props.children}
      </div>
    </div>
  );
}
