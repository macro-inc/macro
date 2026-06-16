import type { ThemeV2 } from '@theme/types/themeTypes';
import IconTextA from '@phosphor-icons/core/regular/text-a-underline.svg?component-solid';

type Token = { l: number; c: number; h: number };
type ThemeChipsSize = 'default' | 'small';

const sizeStyles: Record<
  ThemeChipsSize,
  {
    padding: string;
    gap: string;
    accentSize: string;
    iconSize: string;
  }
> = {
  default: {
    padding: '8px',
    gap: '8px',
    accentSize: '13px',
    iconSize: '18px',
  },
  small: {
    padding: '3px',
    gap: '4px',
    accentSize: '9px',
    iconSize: '12px',
  },
};

/** A theme swatch: an encompassing square of the theme's panel surface with the
 *  accent and ink (A) inside. Always shows the theme's original intended colors
 *  — each theme is intrinsically light or dark. */
export function ThemeChips(props: { theme: ThemeV2; size?: ThemeChipsSize }) {
  const styles = () => sizeStyles[props.size ?? 'default'];
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
      class="inline-flex items-center rounded-sm border border-edge-muted"
      style={{
        'background-color': bg(),
        padding: styles().padding,
        gap: styles().gap,
      }}
    >
      <span
        class="inline-block rounded-xs"
        style={{
          'background-color': accent(),
          width: styles().accentSize,
          height: styles().accentSize,
        }}
      />
      <IconTextA
        style={{ color: ink(), width: styles().iconSize, height: styles().iconSize }}
      />
    </span>
  );
}
