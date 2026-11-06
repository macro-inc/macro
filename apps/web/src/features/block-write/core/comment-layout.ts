export type MarginItem = { id: string; top: number };

/**
 * Stack margin cards beside their anchors without overlap. The active card
 * sits exactly at its anchor; cards above it are pushed up and cards below
 * are pushed down, the way a word processor's markup area behaves. No card
 * starts above the top of the margin, where it could not be scrolled to:
 * when the cards above the active one do not fit, the stack is pushed down.
 */
export function layoutMarginCards(
  items: readonly MarginItem[],
  heights: ReadonlyMap<string, number>,
  activeId: string | null,
  gap = 8
): Map<string, number> {
  const sorted = [...items].sort(
    (a, b) => a.top - b.top || (a.id < b.id ? -1 : 1)
  );
  const height = (id: string) => heights.get(id) ?? 80;
  const placed = new Map<string, number>();
  const pivot = sorted.findIndex((item) => item.id === activeId);
  if (pivot < 0) {
    let bottom = -Infinity;
    for (const item of sorted) {
      const top = Math.max(item.top, bottom + gap);
      placed.set(item.id, top);
      bottom = top + height(item.id);
    }
    return placed;
  }
  const anchor = sorted[pivot];
  placed.set(anchor.id, anchor.top);
  let bottom = anchor.top + height(anchor.id);
  for (const item of sorted.slice(pivot + 1)) {
    const top = Math.max(item.top, bottom + gap);
    placed.set(item.id, top);
    bottom = top + height(item.id);
  }
  let ceiling = anchor.top;
  for (const item of sorted.slice(0, pivot).reverse()) {
    const top = Math.min(item.top, ceiling - gap - height(item.id));
    placed.set(item.id, top);
    ceiling = top;
  }
  if (ceiling >= 0) return placed;
  let floor = 0;
  for (const item of sorted) {
    const top = Math.max(placed.get(item.id) ?? item.top, floor);
    placed.set(item.id, top);
    floor = top + height(item.id) + gap;
  }
  return placed;
}
