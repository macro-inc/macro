import { cn } from '../utils/classname';
import type { JSX } from 'solid-js';
import { Layer } from './Layer';

export type PanelProps = {
  highlightColor?: string;
  children?: JSX.Element;
  active?: boolean;
  class?: string;
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
};

export function Panel(props: PanelProps) {
  return (
    <Layer depth={props.depth ?? 0}>
      <div
        style={{'background-image': `linear-gradient(${props.active ? `${props.highlightColor || 'var(--color-accent)'}, var(--color-edge) 80%` : 'var(--color-edge)'})`}}
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
    </Layer>
  );
}
