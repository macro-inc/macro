import { isMobile } from '@core/mobile/isMobile';
import { type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Layer } from './Layer';
import type { SemanticToken } from '@theme/types/themeTypes';

export type SurfaceProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & {
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
  style?: JSX.CSSProperties;
  highlightColor?: string;
  active?: boolean;
  solid?: boolean;
  // Surface handles the bg color styling. It defaults to the value of our `surface` token (`var(--b0)`). You can use this if you want to instead feed it a different token (e.g. if your surface is an input, you can give it the 'input' token).
  bgToken?: SemanticToken;
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
  ]);

  const defaultHighlightColor = isMobile() ? 'var(--color-edge)' : 'var(--a0)';

  const border = () => {
    const edge = 'var(--b4)';
    const top = local.active
      ? (local.highlightColor ?? defaultHighlightColor)
      : edge;
    const bottom = local.active && !local.solid ? `${edge} 80%` : top;
    return `linear-gradient(${top}, ${bottom})`;
  };

  const bgVariable = () =>
    local.bgToken ? `--color-${local.bgToken}` : '--b0';

  return (
    <Layer depth={local.depth ?? 0}>
      <div
        style={{
          'background-image': `linear-gradient(var(${bgVariable()}), var(${bgVariable()})), ${border()}`,
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
