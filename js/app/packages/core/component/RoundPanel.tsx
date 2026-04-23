import { splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

export type RoundPanelProps = JSX.HTMLAttributes<HTMLDivElement> & {
  highlightColor?: JSX.CSSProperties['color'];
  active?: boolean;
};

export function RoundPanel(props: RoundPanelProps) {
  const [local, rest] = splitProps(props, [
    'active',
    'highlightColor',
    'children',
    'class',
  ]);

  const edge = 'var(--color-edge-muted)';
  const hl = () => local.highlightColor || 'var(--color-accent)';

  return (
    <div
      style={{
        'background-image': `linear-gradient(${local.active ? `${hl()}, ${edge} 80%` : edge})`,
      }}
      class="p-px h-full w-full box-border rounded overflow-clip"
    >
      <div
        class={cn(
          'h-full w-full box-border bg-panel rounded-[3px] overflow-clip',
          local.class
        )}
        {...rest}
      >
        {local.children}
      </div>
    </div>
  );
}
