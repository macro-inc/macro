import type { ThemeV2 } from '@theme/types/themeTypes';
import IconTextA from '@phosphor-icons/core/regular/text-aa.svg?component-solid';
import { cn } from '@ui';

type Token = { l: number; c: number; h: number };
type ThemeChipsSize = 'sm' | 'md';

const sizeStyles: Record<
  ThemeChipsSize,
  {
    root: string;
    accent: string;
    icon: string;
  }
> = {
  md: {
    root: 'gap-2 px-2 py-2.5 rounded-xl',
    accent: 'size-[9px]',
    icon: 'size-[21px]',
  },
  sm: {
    root: 'gap-1 py-[5px] px-[5px] rounded-lg',
    accent: 'size-[6px]',
    icon: 'size-[15px]',
  },
};

/** A theme swatch: an encompassing square of the theme's panel surface with the
 *  accent and ink (A) inside. Always shows the theme's original intended colors
 *  — each theme is intrinsically light or dark. */
export function ThemeChips(props: { theme: ThemeV2; size?: ThemeChipsSize }) {
  const styles = () => sizeStyles[props.size ?? 'md'];
  const oklch = (token: Token) => {
    if (!token) {
      return 'transparent';
    }
    return `oklch(${token.l} ${token.c} ${token.h}deg)`;
  };

  // Approximate the app's prevalent panel surface rather than the darkest base
  // background: lift b0's lightness by the theme's depth, matching how Layer
  // elevates surfaces (b0l + (layer/5) * themeDepth) at a typical panel depth.
  // Flat b0 made the swatches read too dark and blend together.
  const PANEL_LAYER = 2;
  const bg = () => {
    const b0 = props.theme.tokens.b0;
    const l = b0.l + (PANEL_LAYER / 5) * (props.theme.depth ?? 0.15);
    return `oklch(${l} ${b0.c} ${b0.h}deg)`;
  };
  const accent = () => oklch(props.theme.tokens.a0);
  const ink = () => oklch(props.theme.tokens.c0);

  // Uniform padding around and gap between the items so the spacing reads evenly.
  return (
    <span
      class={cn(
        'inline-flex items-center border border-edge-muted',
        styles().root
      )}
      style={{
        'background-color': bg(),
      }}
    >
      <span
        class={cn('inline-block rounded-sm', styles().accent)}
        style={{
          'background-color': accent(),
        }}
      />
      <IconTextA class={styles().icon} style={{ color: ink() }} />
    </span>
  );
}
