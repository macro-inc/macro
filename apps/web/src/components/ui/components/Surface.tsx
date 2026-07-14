import { type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Layer } from './Layer';

export type SurfaceProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & {
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  style?: JSX.CSSProperties;
  edgeColor?: string;
  highlightColor?: string;
  active?: boolean;
  solid?: boolean;
  hideBorder?: boolean;
};

export function Surface(props: SurfaceProps) {
  const [local, rest] = splitProps(props, [
    'highlightColor',
    'edgeColor',
    'children',
    'active',
    'solid',
    'depth',
    'class',
    'style',
    'hideBorder',
  ]);

  const style = (): JSX.CSSProperties => {
    const base: JSX.CSSProperties = {};

    if (!local.hideBorder) {
      base.border = `0.5px solid ${local.edgeColor ?? 'var(--b4)'}`;
    }

    if (local.active) {
      const ring = local.highlightColor ?? 'var(--b4)';
      base['box-shadow'] =
        `0 0 0 2px color-mix(in srgb, ${ring} 60%, transparent)`;
    }

    return { ...base, ...local.style };
  };

  return (
    <Layer depth={local.depth ?? 0}>
      <div
        style={style()}
        class={cn(
          'relative rounded-md overflow-clip min-h-0 size-full bg-(--b0)',
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
