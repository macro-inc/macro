import { splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

export type ClippedPanelProps = JSX.HTMLAttributes<HTMLDivElement> & {
  active?: boolean;
  edgeColor?: JSX.CSSProperties['color'];
  highlightColor?: JSX.CSSProperties['color'];
};

export function ClippedPanel(props: ClippedPanelProps) {
  const [local, rest] = splitProps(props, [
    'active',
    'edgeColor',
    'highlightColor',
    'children',
    'class',
  ]);

  const edge = () => local.edgeColor || 'var(--color-edge-muted)';
  const hl = () => local.highlightColor || 'var(--color-accent)';

  return (
    <div
      style={{
        'background-image': `linear-gradient(${local.active ? `${hl()}, ${edge()} 80%` : edge()})`,
      }}
      class="p-px h-full w-full box-border rounded"
    >
      <div
        class={cn(
          'h-full w-full box-border overflow-hidden bg-panel rounded',
          local.class
        )}
        {...rest}
      >
        {local.children}
      </div>
    </div>
  );
}