import { $getRoot, $isParagraphNode, type LexicalNode } from 'lexical';

/**
 * Replace `target` with `replacements`, returning the last inserted node so the
 * caller can place the selection. Assumes `replacements` is non-empty.
 */
function $replaceWithNodes(
  target: LexicalNode,
  replacements: LexicalNode[]
): LexicalNode {
  const first = replacements[0]!;
  target.replace(first);
  let cursor: LexicalNode = first;
  for (let i = 1; i < replacements.length; i++) {
    const next = replacements[i]!;
    cursor.insertAfter(next);
    cursor = next;
  }
  return cursor;
}

/**
 * Insert `nodes` after `target`, returning the last inserted node so the caller
 * can place the selection. Assumes `nodes` is non-empty.
 */
function $insertNodesAfter(
  target: LexicalNode,
  nodes: LexicalNode[]
): LexicalNode {
  let cursor = target;
  for (const node of nodes) {
    cursor.insertAfter(node);
    cursor = node;
  }
  return cursor;
}

/**
 * Remove an inline await placeholder when there is no content to insert,
 * placing the cursor on the nearest sibling.
 */
function $removeAwaitNodePlacingCursor(awaitNode: LexicalNode): void {
  const next = awaitNode.getNextSibling();
  const prev = awaitNode.getPreviousSibling();
  awaitNode.remove();
  if (next) next.selectStart();
  else if (prev) prev.selectEnd();
}

/**
 * Replace an inline await placeholder with parsed snippet content.
 *
 * The placeholder is an inline node living inside a paragraph, while snippet
 * content is a list of block-level nodes. Inserting blocks directly in place of
 * the placeholder nests paragraphs inside a paragraph, producing content that
 * can't be edited or deleted. This unwraps as needed to keep the resulting tree
 * flat:
 *
 *  1. If the placeholder is the only child of its paragraph parent, replace the
 *     whole paragraph with the snippet's block nodes.
 *  2. If the snippet is a single paragraph of inline content, unwrap it and
 *     splice its children in place of the placeholder so it flows inline.
 *  3. Otherwise, remove the placeholder and insert the snippet's block nodes at
 *     the root, after the placeholder's top-level block.
 */
export function $replaceAwaitNodeWithSnippet(
  awaitNode: LexicalNode,
  snippetNodes: LexicalNode[]
): void {
  if (snippetNodes.length === 0) {
    $removeAwaitNodePlacingCursor(awaitNode);
    return;
  }

  // Case 1: placeholder is the only thing on its line.
  const parent = awaitNode.getParent();
  if ($isParagraphNode(parent) && parent.getChildrenSize() === 1) {
    $replaceWithNodes(parent, snippetNodes).selectEnd();
    return;
  }

  // Case 2: single-paragraph snippet — unwrap to inline content.
  const [onlyNode] = snippetNodes;
  if (snippetNodes.length === 1 && $isParagraphNode(onlyNode)) {
    const inlineChildren = onlyNode.getChildren();
    if (inlineChildren.length > 0) {
      $replaceWithNodes(awaitNode, inlineChildren).selectEnd();
      return;
    }
  }

  // Case 3: multi-block snippet alongside other content — insert at root.
  const topLevel = awaitNode.getTopLevelElement();
  awaitNode.remove();
  if (topLevel) {
    $insertNodesAfter(topLevel, snippetNodes).selectEnd();
  } else {
    $getRoot().append(...snippetNodes);
    snippetNodes[snippetNodes.length - 1]!.selectEnd();
  }
}
