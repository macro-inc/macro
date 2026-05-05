import { cn } from '../utils/classname';
import { splitProps, type JSX } from 'solid-js';
import { Layer } from './Layer';

export type PanelProps = JSX.HTMLAttributes<HTMLDivElement> & {
  highlightColor?: string;
  active?: boolean;
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  hidden?: boolean;
};

export function Panel(props: PanelProps) {
  const [local, rest] = splitProps(props, ['highlightColor', 'active', 'depth', 'class', 'children', 'hidden']);
  return (
    <Layer depth={local.depth ?? 0}>
      <div
        style={{
          'background-image': `linear-gradient(${local.active ? `${local.highlightColor || 'var(--color-accent)'}, var(--color-edge) 80%` : 'var(--color-edge)'})`,
          'display': local.hidden ? 'none' : 'block'
        }}
        class={cn("p-px h-full w-full box-border rounded-md overflow-clip min-h-0")}
      >
        <div
          class={cn(
            'h-full w-full box-border bg-panel rounded-[5px] overflow-clip',
            local.class
          )}
          {...rest}
        >
          {local.children}
        </div>
      </div>
    </Layer>
  );
}
