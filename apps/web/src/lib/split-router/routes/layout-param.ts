import type { LayoutShape } from '../panes/layout-tree';

/** The search key holding how the panes tile, when they don't simply sit side by side. */
export const LAYOUT_SEARCH_KEY = 'layout';

/** Longer values are not layouts the router wrote; this also bounds parse depth. */
const MAX_LAYOUT_LENGTH = 512;

/**
 * The shape in preorder: `p` is a pane, and `r<n>` or `c<n>` is a split of
 * the next `n` shapes side by side or stacked. A pane beside a stack of two
 * is `r2pc2pp`.
 */
export function formatLayoutShape(shape: LayoutShape): string {
  if (shape === 'pane') return 'p';

  const axis = shape.axis === 'row' ? 'r' : 'c';

  return `${axis}${shape.children.length}${shape.children.map(formatLayoutShape).join('')}`;
}

/** The shape `value` records; undefined unless it is one the router could write. */
export function parseLayoutShape(value: string): LayoutShape | undefined {
  if (value.length > MAX_LAYOUT_LENGTH) return;

  let position = 0;

  const parse = (parentAxis?: 'row' | 'column'): LayoutShape | undefined => {
    const token = value[position];
    position += 1;
    if (token === 'p') return 'pane';
    if (token !== 'r' && token !== 'c') return;

    const axis = token === 'r' ? 'row' : 'column';
    if (axis === parentAxis) return;

    const digits = /^[1-9]\d*/.exec(value.slice(position))?.[0];
    if (!digits) return;
    position += digits.length;

    const count = Number(digits);
    if (count < 2) return;

    const children: LayoutShape[] = [];
    for (let index = 0; index < count; index++) {
      const child = parse(axis);
      if (!child) return;
      children.push(child);
    }

    return { axis, children };
  };

  const shape = parse();
  if (position !== value.length) return;

  return shape;
}
