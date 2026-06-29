import {
  $isElementNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type TextNode,
} from 'lexical';

/**
 * Climb from `node` up the tree, returning the first ancestor (or `node`
 * itself) that satisfies `pred`, or `null` if none does. Accepts `null` so
 * callers can pass `node.getParent()` directly.
 */
export function climbWhile(
  node: LexicalNode | null,
  pred: (n: LexicalNode) => boolean
): LexicalNode | null {
  let n = node;
  while (n && !pred(n)) {
    n = n.getParent();
  }
  return n;
}

export function collectTextNodes(element: ElementNode): TextNode[] {
  const out: TextNode[] = [];
  const walk = (node: LexicalNode) => {
    if ($isTextNode(node)) {
      out.push(node);
    } else if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        walk(child);
      }
    }
  };
  for (const child of element.getChildren()) {
    walk(child);
  }
  return out;
}
