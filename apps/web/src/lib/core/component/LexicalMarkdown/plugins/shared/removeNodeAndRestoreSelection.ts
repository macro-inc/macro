import {
  $createParagraphNode,
  $getEditor,
  $getNodeByKey,
  $isRootOrShadowRoot,
  type ElementNode,
  isCurrentlyReadOnlyMode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical';

function $selectNodeBoundary(
  node: LexicalNode | null | undefined,
  boundary: 'start' | 'end'
) {
  if (!node) return false;
  if (boundary === 'start') {
    node.selectStart();
  } else {
    node.selectEnd();
  }
  return true;
}

export function $removeNodeAndRestoreSelection(node: LexicalNode) {
  const parent = node.getParent<ElementNode>();
  const previousSibling = node.getPreviousSibling();
  const nextSibling = node.getNextSibling();

  node.remove();

  if ($selectNodeBoundary(nextSibling, 'start')) return;
  if ($selectNodeBoundary(previousSibling, 'end')) return;
  if (!parent) return;

  if (parent.getChildrenSize() === 0) {
    if ($isRootOrShadowRoot(parent)) {
      const paragraph = $createParagraphNode();
      parent.append(paragraph);
      paragraph.selectStart();
      return;
    }

    parent.selectStart();
    return;
  }

  parent.selectEnd();
}

function isInWritableUpdate(editor: LexicalEditor) {
  try {
    return $getEditor() === editor && !isCurrentlyReadOnlyMode();
  } catch {
    return false;
  }
}

export function removeNodeAndRestoreSelection(
  editor: LexicalEditor,
  nodeKey: NodeKey,
  canRemove: (node: LexicalNode) => boolean = () => true
) {
  const removeNode = () => {
    const node = $getNodeByKey(nodeKey);
    if (!node || !canRemove(node)) return;
    $removeNodeAndRestoreSelection(node);
  };

  if (isInWritableUpdate(editor)) {
    removeNode();
  } else {
    editor.update(removeNode);
  }
}
