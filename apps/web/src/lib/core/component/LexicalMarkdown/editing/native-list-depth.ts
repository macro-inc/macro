import type { EditorView } from '@macro-inc/lexical-wasm-view';

/** Source ListItemNode.getIndent: attached ancestor-LI depth; detached raw indent. */
export function nativeListDepth(
  view: Pick<EditorView, 'node'>,
  key: number
): number | null {
  const node = view.node(key);
  if (node?.type !== 'listitem') return null;
  const seen = new Set([key]);
  let parent = node.parent;
  let depth = 0;
  while (parent !== null) {
    if (seen.has(parent)) return null;
    seen.add(parent);
    const ancestor = view.node(parent);
    if (!ancestor) return null;
    if (ancestor.key === 0) return depth;
    if (ancestor.type === 'listitem') depth += 1;
    parent = ancestor.parent;
  }
  return node.elementProps?.indent ?? 0;
}
