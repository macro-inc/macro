/**
 * The row geometry contract shared by list rows and the soup group headers that
 * have to line up with them. The values themselves live in the --soup-row-*
 * blocks in ListEntity.css; this module owns the names that select them, so the
 * stylesheet and its consumers can't drift apart.
 */

/**
 * Which geometry a row renders with: a full-bleed `row` (WideLayout and the
 * narrow layouts, which lead with an indicator column) or a `card` (InboxCard,
 * which reserves its leading gutter as padding). Soup's per-view row registry
 * pairs each row component with its family and hands it to the group headers.
 */
export type SoupRowFamily = 'row' | 'card';

/**
 * Class that puts a family's --soup-row-* values on an element. Each layout
 * carries the one it is, so its own geometry always resolves no matter who
 * renders it; row roots carry theirs too, for the outer gutter that sits
 * outside the layout; and group headers carry the one matching the rows they
 * sit among. The `row` family splits into `wide` and `narrow` by container
 * width — the same `isWide` its rows read — while `card` has a single form.
 */
export const SOUP_ROW_CLASS = {
  wide: 'soup-row-wide',
  narrow: 'soup-row-narrow',
  card: 'soup-row-card',
} as const;
