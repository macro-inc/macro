import IconTextA from '@phosphor-icons/core/regular/text-aa.svg?component-solid';
import type { ThemeV3 } from '@theme/types/themeTypes';
import { cn } from '@ui';
import type { JSX } from 'solid-js';

type ThemeChipsSize = 'inline' | 'sm' | 'md';

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
  // Em-based so the chip scales with the surrounding font size (~1em tall),
  // letting it baseline-align inline with text (e.g. the theme mention).
  inline: {
    root: 'gap-[0.15em] py-[0.15em] px-[0.15em] rounded-[0.3em]',
    accent: 'size-[0.28em]',
    icon: 'size-[0.62em]',
  },
};

/** A theme swatch: an encompassing square of the theme's panel surface with the
 *  accent and ink (A) inside. Always shows the theme's original intended colors
 *  — each theme is intrinsically light or dark. */
export function ThemeChips(props: { theme: ThemeV3; size?: ThemeChipsSize }) {
  const styles = () => sizeStyles[props.size ?? 'md'];
  const tokenStyle = (): JSX.CSSProperties => {
    const style: Record<string, string> = {
      'background-color': 'var(--color-panel)',
    };
    for (const [token, value] of Object.entries(props.theme.colorTokens)) {
      style[`--color-${token}`] = value;
    }
    return style as JSX.CSSProperties;
  };

  // Uniform padding around and gap between the items so the spacing reads evenly.
  return (
    <span
      class={cn(
        'inline-flex items-center border border-edge-muted',
        styles().root
      )}
      style={tokenStyle()}
    >
      <span
        class={cn('inline-block rounded-sm', styles().accent)}
        style={{
          'background-color': 'var(--color-accent)',
        }}
      />
      <IconTextA class={styles().icon} style={{ color: 'var(--color-ink)' }} />
    </span>
  );
}
