import type { NarrowLayoutVariant } from './shared';

/**
 * Whether an email row uses the compact stacked layout: a narrow desktop list
 * in the `inbox` layout, such as Email beside its reading pane. Touch devices
 * keep their own email rows, with the sender's picture.
 */
export function usesCompactEmailRow(row: {
  wide: boolean;
  touch: boolean;
  narrowLayout: NarrowLayoutVariant | undefined;
  email: boolean;
}): boolean {
  return !row.wide && !row.touch && row.narrowLayout === 'inbox' && row.email;
}
