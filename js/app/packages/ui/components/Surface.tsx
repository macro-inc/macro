import type { SemanticToken } from '@theme/types/themeTypes';
import { type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Layer } from './Layer';

export type SurfaceProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & {
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  style?: JSX.CSSProperties;
  highlightColor?: string;
  active?: boolean;
  solid?: boolean;
  // Surface handles the bg color styling. It defaults to the value of our `surface` token (`var(--b0)`). You can use this if you want to instead feed it a different token (e.g. if your surface is an input, you can give it the 'input' token).
  bgToken?: SemanticToken;
  hideBorder?: boolean;
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
    'bgToken',
    'hideBorder',
  ]);

  const bgVariable = () =>
    local.bgToken ? `--color-${local.bgToken}` : '--b0';

  const style = (): JSX.CSSProperties => {
    const base: JSX.CSSProperties = {
      'background-color': `var(${bgVariable()})`,
    };

    if (!local.hideBorder) {
      base.border = '0.5px solid var(--b4)';
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
