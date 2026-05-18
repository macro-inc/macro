import type { ThemeV2 } from "@theme/types/themeTypes";

export function ThemeChips(props: { theme: ThemeV2 }) {
  const oklch = (token: { l: number; c: number; h: number }) => {
    if (!token) return 'transparent';
    return `oklch(${token.l} ${token.c} ${token.h}deg)`;
  };

  const a0 = () => oklch(props.theme.tokens.a0);
  const b0 = () => oklch(props.theme.tokens.b0);
  const c0 = () => oklch(props.theme.tokens.c0);

  return (
    <span class="inline-flex items-center gap-0.5">
      <span
        class="inline-block size-2.5 rounded-xs border border-edge-muted"
        style={{ 'background-color': a0() }}
      />
      <span
        class="inline-block size-2.5 rounded-xs border border-edge-muted"
        style={{ 'background-color': b0() }}
      />
      <span
        class="inline-block size-2.5 rounded-xs border border-edge-muted"
        style={{ 'background-color': c0() }}
      />
    </span>
  )
}
