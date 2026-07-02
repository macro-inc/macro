import { isMobile } from '@core/mobile/isMobile';
import { DEFAULT_LIGHT_THEME } from '@theme/constants';
import { currentThemeId, themeDepth } from '@theme/signals/themeSignals';
import { createMemo, type JSX } from 'solid-js';

type LayerProps = {
  children?: JSX.Element;
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
};

export function Layer(props: LayerProps) {
  const isDefaultMobileLight = createMemo(
    () => currentThemeId() === DEFAULT_LIGHT_THEME && isMobile()
  );
  // HACK: on default mobile light theme, we reverse the sign
  const sign = () => (isDefaultMobileLight() ? -1 : 1);
  const depth = () => ((props.depth ?? 0) / 5) * themeDepth() * sign();
  
  // As Layer depth increases, Borders should get lighter slower than surfaces. So we multiple them by this.
  const BORDER_SCALAR = 0.4;
  // If --b0 is black, or near black, we need to set a min step to get appropriate contrast
  const nearBlackStepMin = () => (props.depth ?? 0) > 0 ? 0.19 : 0;

  return (
    <div
      data-layer-depth={props.depth}
      style={{
        display: 'contents',
        '--b0': `oklch(max(var(--b0l) + ${depth()}, ${nearBlackStepMin()}) var(--b0c) var(--b0h))`,
        '--b1': `oklch(calc(var(--b1l) + ${depth()}) var(--b1c) var(--b1h))`,
        '--b2': `oklch(calc(var(--b2l) + ${depth()}) var(--b2c) var(--b2h))`,
        '--b3': `oklch(calc(var(--b3l) + ${depth() * BORDER_SCALAR}) var(--b3c) var(--b3h))`,
        '--b4': `oklch(calc(var(--b4l) + ${depth() * BORDER_SCALAR}) var(--b4c) var(--b4h))`,
        '--c0': `oklch(calc(var(--c0l) + ${depth()}) var(--c0c) var(--c0h))`,
        '--c1': `oklch(calc(var(--c1l) + ${depth()}) var(--c1c) var(--c1h))`,
        '--c2': `oklch(calc(var(--c2l) + ${depth()}) var(--c2c) var(--c2h))`,
        '--c3': `oklch(calc(var(--c3l) + ${depth()}) var(--c3c) var(--c3h))`,
        '--c4': `oklch(calc(var(--c4l) + ${depth()}) var(--c4c) var(--c4h))`,

        '--color-accent': 'var(--a0)',
        '--color-accent-bg': 'oklch(from var(--a0) l c h / 0.15)',

        // TODO (seamus): --color-surface could be better handled with fractional layer depth
        '--color-surface': 'var(--b0)',

        '--color-shadow':
          'oklch(calc(var(--b0l) - 0.005 ) var(--b0c) var(--b0h) / 0.2)',
        // TODO (seamus): --color-message could be better handled with fractional layer depth
        '--color-overlay': 'oklch(from var(--b2) l c h / 0.5)',
        '--color-edge-muted': 'var(--b3)',
        '--color-edge': 'var(--b4)',
        '--color-rail': 'color-mix(in oklch, var(--b4) 90%, var(--c0))',

        '--color-ink': 'var(--c0)',
        '--color-ink-muted': 'var(--c1)',
        '--color-ink-extra-muted': 'var(--c2)',
        '--color-ink-disabled': 'var(--c3)',
        '--color-ink-placeholder': 'oklch(var(--c4) / 0.5))',

        // Semantic design tokens with theme overrides, get set to the theme override, otherwise, they get set to --b0, same as `--color-surface`, and get controlled entirely by Layer system
        '--color-page': 'var(--theme-page, var(--b0))',
        '--color-panel': 'var(--theme-panel, var(--b0))',
        '--color-inset': 'var(--theme-inset, var(--b0))',
        '--color-dialog': 'var(--theme-dialog, var(--b0))',
        '--color-menu': 'var(--theme-menu, var(--b0))',
        '--color-input': 'var(--theme-input, var(--b0))',
        '--color-message':
          'var(--theme-message, color-mix(in oklch, var(--b1) 50%, var(--b2)))',
        '--color-active': 'var(--theme-active, var(--b1))',
        '--color-hover': 'var(--theme-hover, var(--b2))',
        '--color-button': 'var(--theme-button, var(--b0))',
      }}
    >
      {props.children}
    </div>
  );
}
