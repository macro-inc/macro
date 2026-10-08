import type { GraphicsDocument, GraphicsItem } from './model';
import { children, keysAt } from './ordering';
import { freezeDocument, roots } from './scene';

export type LayerOperation = 'front' | 'back' | 'forward' | 'backward';

/** Reorder selected roots within each parent, retaining their relative order. */
export function reorderNodes(
  doc: GraphicsDocument,
  ids: readonly string[],
  operation: LayerOperation
): GraphicsDocument {
  const selected = new Set(roots(doc, ids));
  const parents = new Set<string>();
  for (const id of selected) {
    const node = doc.items[id];
    if (node && node.type !== 'surface') parents.add(node.placement.parentId);
  }
  const changes: Record<string, GraphicsItem> = Object.create(null);
  for (const parentId of parents) {
    const before = children(doc, parentId);
    let after = [...before];
    if (operation === 'front' || operation === 'back') {
      const moving = before.filter((id) => selected.has(id));
      const staying = before.filter((id) => !selected.has(id));
      after =
        operation === 'front'
          ? [...staying, ...moving]
          : [...moving, ...staying];
    } else if (operation === 'forward') {
      for (let i = after.length - 2; i >= 0; i--) {
        if (selected.has(after[i]!) && !selected.has(after[i + 1]!))
          [after[i], after[i + 1]] = [after[i + 1]!, after[i]!];
      }
    } else {
      for (let i = 1; i < after.length; i++) {
        if (selected.has(after[i]!) && !selected.has(after[i - 1]!))
          [after[i], after[i - 1]] = [after[i - 1]!, after[i]!];
      }
    }
    const moved = new Set(
      after.filter((id, index) => selected.has(id) && before[index] !== id)
    );
    // Allocate between stationary neighbors, touching only moved nodes.
    for (let start = 0; start < after.length; start++) {
      if (!moved.has(after[start]!)) continue;
      let end = start + 1;
      while (end < after.length && moved.has(after[end]!)) end++;
      const surrounding = [...after.slice(0, start), ...after.slice(end)];
      const keys = keysAt(doc, surrounding, start, end - start);
      for (let i = start; i < end; i++) {
        const id = after[i]!,
          node = doc.items[id];
        if (node && node.type !== 'surface')
          changes[id] = {
            ...node,
            placement: { ...node.placement, sortKey: keys[i - start]! },
          };
      }
      start = end - 1;
    }
  }
  return Object.keys(changes).length
    ? freezeDocument({ ...doc, items: { ...doc.items, ...changes } })
    : doc;
}
