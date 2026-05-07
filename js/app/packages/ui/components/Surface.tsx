import { splitProps, type JSX } from 'solid-js';
import { cn } from '../utils/classname';
import { Layer } from './Layer';

export type SurfaceProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & {
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  style?: JSX.CSSProperties;
  highlightColor?: string;
  active?: boolean;
};

export function Surface(props: SurfaceProps) {
  const [local, rest] = splitProps(props, [
    'highlightColor',
    'children',
    'active',
    'depth',
    'class',
    'style',
  ]);

  return (
    <Layer depth={local.depth ?? 0}>
      <div
        style={{
          'background-image': local.active ? `linear-gradient(var(--b0), var(--b0)), linear-gradient(${local.highlightColor || 'var(--a0)'}, var(--b4) 80%)` : 'linear-gradient(var(--b0), var(--b0)), linear-gradient(var(--b4), var(--b4))',
          'background-origin': 'padding-box, border-box',
          'background-clip': 'padding-box, border-box',
          'border': '1px solid #0000',
          ...local.style,
        }}
        class={cn(
          'relative rounded-md overflow-clip min-h-0 size-full',
          "after:content-[''] after:absolute after:inset-0 after:pointer-events-none after:rounded-[inherit] after:z-10",
          'after:shadow-[inset_0_0_4px_var(--color-shadow)]',
          local.class,
        )}
        {...rest}
      >
        {local.children}
      </div>
    </Layer>
  );
}
