import { themeDepth } from '@theme/signals/themeSignals';
import type { JSX } from 'solid-js';

type LayerProps = {
  children?: JSX.Element;
  depth?: 0 | 1 | 2 | 3 | 4 | 5;
};

export function Layer(props: LayerProps) {
  const depth = () => ((props.depth ?? 0) / 5) * themeDepth();
  return (
    <div
      data-layer-depth={props.depth}
      style={{
        'display': 'contents',
        '--b0': `oklch(calc(var(--b0l) + ${depth()}) var(--b0c) var(--b0h))`,
        '--b1': `oklch(calc(var(--b1l) + ${depth()}) var(--b1c) var(--b1h))`,
        '--b2': `oklch(calc(var(--b2l) + ${depth()}) var(--b2c) var(--b2h))`,
        '--b3': `oklch(calc(var(--b3l) + ${depth()}) var(--b3c) var(--b3h))`,
        '--b4': `oklch(calc(var(--b4l) + ${depth()}) var(--b4c) var(--b4h))`,
        '--c0': `oklch(calc(var(--c0l) + ${depth()}) var(--c0c) var(--c0h))`,
        '--c1': `oklch(calc(var(--c1l) + ${depth()}) var(--c1c) var(--c1h))`,
        '--c2': `oklch(calc(var(--c2l) + ${depth()}) var(--c2c) var(--c2h))`,
        '--c3': `oklch(calc(var(--c3l) + ${depth()}) var(--c3c) var(--c3h))`,
        '--c4': `oklch(calc(var(--c4l) + ${depth()}) var(--c4c) var(--c4h))`,

        '--color-accent':          'var(--a0)',
        '--color-accent-bg':       'oklch(from var(--a0) l c h / 0.15)',

        // TODO (seamus): --color-surface could be better handled with fractional layer depth
        '--color-surface':         'var(--b0)',
        '--color-shadow':          'oklch(calc(var(--b0l) - 0.005 ) var(--b0c) var(--b0h) / 0.2)',
        // TODO (seamus): --color-message could be better handled with fractional layer depth
        '--color-message':         'color-mix(in oklch, var(--b1) 50%, var(--b2))',
        '--color-active':          'var(--b1)',
        '--color-hover':           'var(--b2)',
        '--color-overlay':         'oklch(from var(--b2) l c h / 0.5)',
        '--color-edge-muted':      'var(--b3)',
        '--color-edge':            'var(--b4)',
        '--color-rail':            'color-mix(in oklch, var(--b0) 75%, var(--c0))',

        '--color-ink':             'var(--c0)',
        '--color-ink-muted':       'var(--c1)',
        '--color-ink-extra-muted': 'var(--c2)',
        '--color-ink-disabled':    'var(--c3)',
        '--color-ink-placeholder': 'oklch(var(--c4) / 0.5))',

      }}
    >
      {props.children}
    </div>
  );
}
