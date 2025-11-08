import { $isElementNode, type LexicalNode } from "lexical"

interface NodeWithSearchText extends LexicalNode {
  getSearchText(): string;
}

function $hasOwnSearchTextHandler(node: LexicalNode): node is NodeWithSearchText {
  return 'getSearchText' in node && typeof node.getSearchText === 'function';
}

export function $extractSearchText(node: LexicalNode): string {
  if ($hasOwnSearchTextHandler(node)) {
    return node.getSearchText();
  }

  if (!$isElementNode(node)) {
    return node.getTextContent();
  }

  let searchText = '';
  const children = node.getChildren();

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    searchText += $extractSearchText(child);
    if ($isElementNode(child) && i !== children.length - 1 && !child.isInline()) {
      searchText += '\n\n';
    }
  }

  return searchText;
}
