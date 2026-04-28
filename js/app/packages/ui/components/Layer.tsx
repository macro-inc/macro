import type { JSX } from 'solid-js';

export type LayerProps = {
  children?: JSX.Element;
  depth?: number;
};

export function Layer(props: LayerProps) {
  const depth = props.depth ?? 0;
  return (
    <div
      style={{
        'display': 'contents',

        '--b0': `oklch(calc(var(--b0l) + ${depth}) var(--b0c) var(--b0h))`,
        '--b1': `oklch(calc(var(--b1l) + ${depth}) var(--b1c) var(--b1h))`,
        '--b2': `oklch(calc(var(--b2l) + ${depth}) var(--b2c) var(--b2h))`,
        '--b3': `oklch(calc(var(--b3l) + ${depth}) var(--b3c) var(--b3h))`,
        '--b4': `oklch(calc(var(--b4l) + ${depth}) var(--b4c) var(--b4h))`,
        '--c0': `oklch(calc(var(--c0l) + ${depth}) var(--c0c) var(--c0h))`,
        '--c1': `oklch(calc(var(--c1l) + ${depth}) var(--c1c) var(--c1h))`,
        '--c2': `oklch(calc(var(--c2l) + ${depth}) var(--c2c) var(--c2h))`,
        '--c3': `oklch(calc(var(--c3l) + ${depth}) var(--c3c) var(--c3h))`,
        '--c4': `oklch(calc(var(--c4l) + ${depth}) var(--c4c) var(--c4h))`,

        '--color-accent-ink':      'var(--a0)',
        '--color-accent':          'var(--a0)',
        '--color-focus':           'var(--a0)',

        '--color-dialog':          'var(--b0)',
        '--color-input':           'var(--b0)',
        '--color-menu':            'var(--b0)',
        '--color-button':          'var(--b1)',
        '--color-panel':           'var(--b1)',
        '--color-active':          'var(--b2)',
        '--color-hover':           'var(--b2)',
        '--color-message':         'var(--b3)',
        '--color-page':            'var(--b3)',
        '--color-edge':            'var(--b4)',

        '--color-ink':             'var(--c0)',
        '--color-ink-muted':       'var(--c1)',
        '--color-ink-extra-muted': 'var(--c2)',
        '--color-ink-disabled':    'var(--c3)',
        '--color-ink-placeholder': 'var(--c4)',

        '--color-edge-muted': 'color-mix(in srgb, var(--b4), var(--b1) 50%)',
        '--color-overlay':    'oklch(from var(--b2) l c h / 0.5)',
        '--color-accent-bg':  'oklch(from (var(--a0)) / 0.15)',
      }}
    >
      {props.children}
    </div>
  );
}
