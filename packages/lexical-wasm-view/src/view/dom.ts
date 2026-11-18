/** Resolve the single text leaf through TextNode's optional semantic wrapper. */
export function textLeaf(element: Node | null | undefined): Node | null {
  let node = element ?? null;
  while (node && node.nodeType !== 3) {
    if (node.childNodes.length !== 1) return null;
    node = node.firstChild;
  }
  return node;
}
