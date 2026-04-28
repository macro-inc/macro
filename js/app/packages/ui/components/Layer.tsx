import type { JSX } from 'solid-js';
import { themeReactive } from '@theme/signals/themeReactive';

export type LayerProps = {
  children?: JSX.Element;
  depth?: number;
};

export function Layer(props: LayerProps) {
  const depth = 0.2;
  return (
    <div
      style={{
        '--b0': `oklch(${themeReactive.b0.l[0]() + depth} ${themeReactive.b0.c[0]()} ${themeReactive.b0.h[0]()}deg)`,
        '--b1': `oklch(${themeReactive.b1.l[0]() + depth} ${themeReactive.b1.c[0]()} ${themeReactive.b1.h[0]()}deg)`,
        '--b2': `oklch(${themeReactive.b2.l[0]() + depth} ${themeReactive.b2.c[0]()} ${themeReactive.b2.h[0]()}deg)`,
        '--b3': `oklch(${themeReactive.b3.l[0]() + depth} ${themeReactive.b3.c[0]()} ${themeReactive.b3.h[0]()}deg)`,
        '--b4': `oklch(${themeReactive.b4.l[0]() + depth} ${themeReactive.b4.c[0]()} ${themeReactive.b4.h[0]()}deg)`,
        '--c0': `oklch(${themeReactive.c0.l[0]() + depth} ${themeReactive.c0.c[0]()} ${themeReactive.c0.h[0]()}deg)`,
        '--c1': `oklch(${themeReactive.c1.l[0]() + depth} ${themeReactive.c1.c[0]()} ${themeReactive.c1.h[0]()}deg)`,
        '--c2': `oklch(${themeReactive.c2.l[0]() + depth} ${themeReactive.c2.c[0]()} ${themeReactive.c2.h[0]()}deg)`,
        '--c3': `oklch(${themeReactive.c3.l[0]() + depth} ${themeReactive.c3.c[0]()} ${themeReactive.c3.h[0]()}deg)`,
        '--c4': `oklch(${themeReactive.c4.l[0]() + depth} ${themeReactive.c4.c[0]()} ${themeReactive.c4.h[0]()}deg)`,
        'display': 'contents',
      }}
    >
      {props.children}
    </div>
  );
}
