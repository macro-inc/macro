import { $isHeadingNode } from '@lexical/rich-text';
import { $isTableNode } from '@lexical/table';
import {
  $findMatchingParent,
  $insertNodeToNearestRoot,
  mergeRegister,
} from '@lexical/utils';
import {
  $canHostTable,
  $createCollapsibleContainerNode,
  $createCollapsibleContentNode,
  $createCollapsibleTitleNode,
  $isCollapsibleContainerNode,
  $isCollapsibleContentNode,
  $isCollapsibleTitleNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  type CollapsibleHeading,
  CollapsibleTitleNode,
  isCollapsibleHeading,
} from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';

export const INSERT_COLLAPSIBLE_COMMAND: LexicalCommand<CollapsibleHeading> =
  createCommand('INSERT_COLLAPSIBLE_COMMAND');

function $onEscape(before: boolean): boolean {
  const selection = $getSelection();
  if (
    !$isRangeSelection(selection) ||
    !selection.isCollapsed() ||
    selection.anchor.offset !==
      (before ? 0 : selection.anchor.getNode().getTextContentSize())
  ) {
    return false;
  }

  const container = $findMatchingParent(
    selection.anchor.getNode(),
    $isCollapsibleContainerNode
  );
  if (!container) return false;

  const parent = container.getParent();
  if (!parent) return false;

  const sibling = before ? parent.getFirstChild() : parent.getLastChild();
  const edgeKey = before
    ? container.getFirstDescendant()?.getKey()
    : container.getLastDescendant()?.getKey();

  if (sibling !== container || selection.anchor.key !== edgeKey) {
    return false;
  }

  const paragraph = $createParagraphNode();
  if (before) {
    container.insertBefore(paragraph);
  } else {
    container.insertAfter(paragraph);
  }
  paragraph.selectStart();
  return true;
}

function $headingFromNode(node: LexicalNode): CollapsibleHeading | null {
  if (!$isHeadingNode(node)) return null;
  const tag = node.getTag();
  return isCollapsibleHeading(tag) ? tag : null;
}

function $wrapTargetInCollapsible(
  target: LexicalNode,
  heading: CollapsibleHeading
): void {
  const container = $createCollapsibleContainerNode(true);
  const resolvedHeading =
    heading === 'p' ? ($headingFromNode(target) ?? 'p') : heading;
  const title = $createCollapsibleTitleNode(resolvedHeading);
  const content = $createCollapsibleContentNode();

  if ($isParagraphNode(target) || $isHeadingNode(target)) {
    title.append(...target.getChildren());
    content.append($createParagraphNode());
    target.replace(container);
    container.append(title, content);
    title.selectEnd();
    return;
  }

  target.insertBefore(container);
  content.append(target);
  if (content.getChildrenSize() === 0) {
    content.append($createParagraphNode());
  }
  container.append(title, content);
  title.selectEnd();
}

function $insertCollapsible(heading: CollapsibleHeading): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;

  const anchor = selection.anchor.getNode();
  const table = $findMatchingParent(anchor, $isTableNode);
  if (table && $canHostTable(table.getParent())) {
    $wrapTargetInCollapsible(table, heading);
    return true;
  }

  const top = anchor.getTopLevelElement();
  if (
    top &&
    $canHostTable(top.getParent()) &&
    !$isCollapsibleContainerNode(top) &&
    !$isCollapsibleTitleNode(top) &&
    !$isCollapsibleContentNode(top)
  ) {
    $wrapTargetInCollapsible(top, heading);
    return true;
  }

  const container = $createCollapsibleContainerNode(true);
  const title = $createCollapsibleTitleNode(heading);
  const content = $createCollapsibleContentNode();
  content.append($createParagraphNode());
  container.append(title, content);
  $insertNodeToNearestRoot(container);
  title.selectEnd();
  return true;
}

function registerCollapsiblePlugin(editor: LexicalEditor): () => void {
  if (
    !editor.hasNode(CollapsibleContainerNode) ||
    !editor.hasNode(CollapsibleTitleNode) ||
    !editor.hasNode(CollapsibleContentNode)
  ) {
    return () => {};
  }

  return mergeRegister(
    editor.registerCommand(
      INSERT_COLLAPSIBLE_COMMAND,
      (heading) => $insertCollapsible(heading),
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerNodeTransform(CollapsibleContentNode, (node) => {
      const parent = node.getParent();
      if (!$isCollapsibleContainerNode(parent)) {
        const children = node.getChildren();
        for (const child of children) {
          node.insertBefore(child);
        }
        node.remove();
        return;
      }
      if (node.isEmpty()) {
        node.append($createParagraphNode());
      }
    }),

    editor.registerNodeTransform(CollapsibleTitleNode, (node) => {
      const parent = node.getParent();
      if (!$isCollapsibleContainerNode(parent)) {
        const paragraph = $createParagraphNode();
        paragraph.append(...node.getChildren());
        node.replace(paragraph);
      }
    }),

    editor.registerNodeTransform(CollapsibleContainerNode, (node) => {
      const children = node.getChildren();
      if (
        children.length !== 2 ||
        !$isCollapsibleTitleNode(children[0]) ||
        !$isCollapsibleContentNode(children[1])
      ) {
        for (const child of children) {
          node.insertBefore(child);
        }
        node.remove();
      }
    }),

    editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => $onEscape(false),
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      KEY_ARROW_RIGHT_COMMAND,
      () => $onEscape(false),
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      () => $onEscape(true),
      COMMAND_PRIORITY_LOW
    ),
    editor.registerCommand(
      KEY_ARROW_LEFT_COMMAND,
      () => $onEscape(true),
      COMMAND_PRIORITY_LOW
    )
  );
}

export function collapsiblePlugin() {
  return (editor: LexicalEditor) => registerCollapsiblePlugin(editor);
}
