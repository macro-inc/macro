export type MarginItem = { id: string; top: number };

/**
 * Stack margin cards beside their anchors without overlap. The active card
 * sits exactly at its anchor; cards above it are pushed up and cards below
 * are pushed down, the way a word processor's markup area behaves.
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
  return placed;
}
