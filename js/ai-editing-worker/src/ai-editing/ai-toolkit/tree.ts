import {
  $isElementNode,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
  type TextNode,
} from 'lexical';

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
