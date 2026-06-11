import type { ThemeV2 } from '@theme/types/themeTypes';
import IconTextT from '@phosphor-icons/core/regular/text-t.svg?component-solid';

type Token = { l: number; c: number; h: number };

/** A theme swatch: an encompassing square of the theme's background color with
 *  the accent and ink (T) inside. Always shows the theme's original intended
 *  colors — each theme is intrinsically light or dark. */
export function ThemeChips(props: { theme: ThemeV2 }) {
  const oklch = (token: Token) => {
    if (!token) { return 'transparent'; }
    return `oklch(${token.l} ${token.c} ${token.h}deg)`;
  };

  const bg = () => oklch(props.theme.tokens.b0);
  const accent = () => oklch(props.theme.tokens.a0);
  const ink = () => oklch(props.theme.tokens.c0);

  // Uniform padding around and gap between the items so the spacing reads evenly.
  return (
    <span
      class="inline-flex items-center rounded-sm border border-edge-muted"
      style={{ 'background-color': bg(), padding: '6px', gap: '6px' }}
    >
      <span
        class="inline-block rounded-xs"
        style={{ 'background-color': accent(), width: '12px', height: '12px' }}
      />
      <IconTextT style={{ color: ink(), width: '14px', height: '14px' }} />
    </span>
  );
}
