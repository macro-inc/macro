import { type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Layer } from './Layer';

export type SurfaceProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & {
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  style?: JSX.CSSProperties;
  highlightColor?: string;
  active?: boolean;
  solid?: boolean;
};

export function Surface(props: SurfaceProps) {
  const [local, rest] = splitProps(props, [
    'highlightColor',
    'children',
    'active',
    'solid',
    'depth',
    'class',
    'style',
  ]);

  const border = () => {
    const edge = 'var(--b4)';
    const top = local.active ? (local.highlightColor ?? 'var(--a0)') : edge;
    const bottom = local.active && !local.solid ? `${edge} 80%` : top;
    return `linear-gradient(${top}, ${bottom})`;
  };

  return (
    <Layer depth={local.depth ?? 0}>
      <div
        style={{
          'background-image': `linear-gradient(var(--b0), var(--b0)), ${border()}`,
          'background-origin': 'padding-box, border-box',
          'background-clip': 'padding-box, border-box',
          border: '1px solid #0000',
          ...local.style,
        }}
        class={cn(
          'relative rounded-md overflow-clip min-h-0 size-full',
          local.class
        )}
        {...rest}
      >
        {local.children}
      </div>
    </Layer>
  );
}

/*
shadow sudo element
"after:content-[''] after:absolute after:inset-0 after:pointer-events-none after:rounded-[inherit] after:z-10",
'after:shadow-[inset_0_0_4px_var(--color-shadow)]'"
*/
