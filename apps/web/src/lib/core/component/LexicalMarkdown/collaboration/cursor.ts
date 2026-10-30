import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';

import { $getNodeById, type NodeIdMappings } from '@macro-inc/lexical-core';
import {
  $createPoint,
  $createRangeSelection,
  $getNodeByKey,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type BaseSelection,
  type LexicalEditor,
  type NodeKey,
  type NodeSelection,
  type Point,
  type RangeSelection,
} from 'lexical';
import {
  type Container,
  type Cursor,
  LoroList,
  LoroMap,
  LoroMovableList,
  LoroText,
} from 'loro-crdt';
import type { LexicalSelectionAwareness, NodeCursor } from './LexicalAwareness';
import { $findLoroContainerForLexicalNode } from './mapping';

type ListLikeContainer = LoroMovableList | LoroList;

const warn = (...args: any[]) => {
  if (DEV_MODE_ENV) console.warn('Collab Cursors: ', ...args);
};

function isListLikeContainer(
  container: Container
): container is ListLikeContainer {
  return container instanceof LoroMovableList || container instanceof LoroList;
}

function isTextLikeContainer(container: LoroMap): boolean {
  return (
    container.get('type') === 'text' ||
    container.get('type') === 'inline-search' ||
    container.get('type') === 'code-highlight'
  );
}

function getListLikeParent(
  container: Container
): ListLikeContainer | undefined {
  let parentContainer = container.parent();

  if (!parentContainer) {
    warn('no parent container');
    return undefined;
  }

  if (!isListLikeContainer(parentContainer)) {
    warn('parent container is not a list');
    return undefined;
  }

  return parentContainer;
}

function getIndexOfContainerInParentList(
  container: Container,
  parent: ListLikeContainer
): number | undefined {
  let shallow = parent.getShallowValue();

  const containerId = container.id;

  const index = shallow.indexOf(containerId);

  return index;
}

// Convert Lexical selection to Loro cursors
export function $convertLexicalSelectionToCursors(
  loroManager: LoroManager,
  mapping: NodeIdMappings,
  selection: BaseSelection
): { anchor: NodeCursor; focus: NodeCursor } | undefined {
  // Get current selection from Lexical

  if (!selection) {
    warn('no selection');
    return undefined;
  }

  if ($isRangeSelection(selection)) {
    const rangeSelection = selection as RangeSelection;
    const anchor = rangeSelection.anchor;
    const focus = rangeSelection.focus;

    const anchorCursor = lexicalPointToCursor(anchor, loroManager, mapping);
    const focusCursor = lexicalPointToCursor(focus, loroManager, mapping);

    if (!anchorCursor || !focusCursor) {
      warn('no anchor or focus cursor');
      return undefined;
    }

    return {
      anchor: anchorCursor,
      focus: focusCursor,
    };
  } else if ($isNodeSelection(selection)) {
    const nodeSelection = selection as NodeSelection;
    const nodes = nodeSelection.getNodes();

    if (nodes.length === 0) {
      return undefined;
    }

    // For node selection, we'll use the start and end of the selected node(s)
    const firstNode = nodes.at(0);
    const lastNode = nodes.at(-1);

    if (!firstNode || !lastNode) {
      return undefined;
    }

    const firstNodeKey = firstNode.getKey();
    const lastNodeKey = lastNode.getKey();

    const firstNodeId = mapping.nodeKeyToIdMap.get(firstNodeKey);
    const lastNodeId = mapping.nodeKeyToIdMap.get(lastNodeKey);

    if (!firstNodeId || !lastNodeId) {
      warn('could not find id for node ');
      return undefined;
    }

    // Find Loro containers for the selected nodes
    const firstContainerId = $findLoroContainerForLexicalNode(
      loroManager,
      firstNode,
      mapping
    );

    const lastContainerId = $findLoroContainerForLexicalNode(
      loroManager,
      lastNode,
      mapping
    );

    if (!firstContainerId || !lastContainerId) {
      return undefined;
    }

    let anchorCursor: Cursor | undefined;
    let focusCursor: Cursor | undefined;

    // Create cursor at the start of the first node
    const firstContainerResult = loroManager.getContainerById(firstContainerId);

    if (firstContainerResult.isErr()) {
      warn('Failed to get first container', firstContainerResult);
      return undefined;
    }

    const firstContainer = firstContainerResult.value;
    if (firstContainer instanceof LoroText) {
      anchorCursor = firstContainer.getCursor(0);
    } else if (firstContainer instanceof LoroMovableList) {
      anchorCursor = firstContainer.getCursor(0);
    }

    // Create cursor at the end of the last node
    const lastContainerResult = loroManager.getContainerById(lastContainerId);

    if (lastContainerResult.isErr()) {
      warn('Failed to get last container', lastContainerResult);
      return undefined;
    }

    const lastContainer = lastContainerResult.value;

    if (lastContainer instanceof LoroText) {
      focusCursor = lastContainer.getCursor(lastContainer.length);
    } else if (lastContainer instanceof LoroMovableList) {
      focusCursor = lastContainer.getCursor(lastContainer.length);
    }

    if (!anchorCursor || !focusCursor) {
      warn('no anchor or focus cursor');
      return undefined;
    }

    return {
      anchor: {
        nodeId: firstNodeId,
        cursor: anchorCursor,
      },
      focus: {
        nodeId: lastNodeId,
        cursor: focusCursor,
      },
    };
  }

  return undefined;
}

// Convert from Lexical point to Loro cursor
function lexicalPointToCursor(
  point: Point,
  loroManager: LoroManager,
  mapping: NodeIdMappings
): NodeCursor | undefined {
  const node = point.getNode();
  const nodeKey = node.getKey();
  const nodeId = mapping.nodeKeyToIdMap.get(nodeKey);
  const offset = point.offset;

  if (!nodeId) {
    warn('no node id for key', nodeKey);
    return undefined;
  }

  // Find the corresponding Loro container for this Lexical node
  const containerId = $findLoroContainerForLexicalNode(
    loroManager,
    node,
    mapping
  );

  if (!containerId) {
    return undefined;
  }

  // Get the container and create the cursor
  const maybeContainer = loroManager.getContainerById(containerId);
  if (maybeContainer.isErr()) {
    warn('Failed to get container', maybeContainer);
    return undefined;
  }

  let container = maybeContainer.value;

  let cursor: Cursor | undefined;
  if (container instanceof LoroText) {
    cursor = container.getCursor(offset);
  } else if (container instanceof LoroMovableList) {
    cursor = container.getCursor(offset);
    // This is the parent container for text
  } else if (container instanceof LoroMap) {
    if (isTextLikeContainer(container)) {
      let textContainer: LoroText | undefined;
      try {
        textContainer = container.getOrCreateContainer('text', new LoroText());
      } catch (e) {
        warn(
          'Expected text container to exist',
          e,
          container.getShallowValue()
        );
        return undefined;
      }
      cursor = textContainer.getCursor(offset);
    } else if (container.get('children') instanceof LoroMovableList) {
      // An element point (after a line break or an inline decorator, say)
      // sits between children, so it is a cursor in the children list.
      cursor = (container.get('children') as LoroMovableList).getCursor(offset);
    } else {
      // An element with no children yet: its point can only be offset 0, so
      // the element's own place in its parent list stands for it.
      const parent = getListLikeParent(container);

      if (!parent) {
        warn('no parent for list');
        return undefined;
      }

      const index = getIndexOfContainerInParentList(container, parent);

      if (index === undefined) {
        warn('could not find index of container in parent list');
        return undefined;
      }

      cursor = parent.getCursor(index);
    }
  }

  if (!cursor) {
    return undefined;
  }

  return {
    nodeId,
    cursor,
  };
}

// Convert from Loro cursor back to Lexical position
export function $cursorToLexicalPoint(
  cursor: NodeCursor,
  loroManager: LoroManager,
  editor: LexicalEditor,
  mapping: NodeIdMappings
): Point | null {
  const cursorContainerID = cursor.cursor.containerId();
  const nodeId = cursor.nodeId;
  const node = $getNodeById(editor, mapping.idToNodeKeyMap, nodeId);

  if (!node) {
    warn('no node for loro container', nodeId);
    return null;
  }

  let maybeContainer = loroManager.getContainerById(cursorContainerID);

  if (maybeContainer.isErr()) {
    warn('Failed to get container', maybeContainer);
    return null;
  }

  if (!maybeContainer.value) {
    warn("no container for cursor's containe id");
    return null;
  }

  const nodeKey = node.getKey();

  // Get position info from the cursor
  const posResult = loroManager.getCursorPos(cursor.cursor);

  if (posResult.isErr()) {
    warn('Failed to get cursor position', posResult);
    return null;
  }

  let pos = posResult.value;
  const cursorContainer = maybeContainer.value;
  // An element point is a cursor in the element's children list; any other
  // cursor on an element (its place in its parent list) is offset 0.
  const isChildOffset =
    cursorContainer instanceof LoroMovableList &&
    cursorContainer.parent()?.id ===
      $findLoroContainerForLexicalNode(loroManager, node, mapping);

  // Create a Point for the Lexical node
  return $createPointFromKeyAndOffset(nodeKey, pos.offset, isChildOffset);
}

function $createPointFromKeyAndOffset(
  nodeKey: NodeKey,
  offset: number,
  isChildOffset: boolean
): Point | null {
  const node = $getNodeByKey(nodeKey);

  if (!node) {
    return null;
  }

  if ($isTextNode(node) || node.getType() === 'inline-search') {
    return $createPoint(nodeKey, offset, 'text');
  }

  const childOffset =
    isChildOffset && $isElementNode(node)
      ? Math.min(offset, node.getChildrenSize())
      : 0;
  return $createPoint(nodeKey, childOffset, 'element');
}

export function $createSelectionFromPeerAwareness(
  loroManager: LoroManager,
  editor: LexicalEditor,
  peerAwareness: LexicalSelectionAwareness,
  mapping: NodeIdMappings,
  format: number
) {
  const anchor = peerAwareness?.anchor;
  const focus = peerAwareness?.focus;

  const anchorPoint = anchor
    ? $cursorToLexicalPoint(anchor, loroManager, editor, mapping)
    : null;

  const focusPoint = focus
    ? $cursorToLexicalPoint(focus, loroManager, editor, mapping)
    : null;

  const selection = $createRangeSelection();

  if (!anchorPoint || !focusPoint) {
    warn('no anchor or focus point');
    return;
  }
  selection.anchor.set(anchorPoint.key, anchorPoint.offset, anchorPoint.type);
  selection.focus.set(focusPoint.key, focusPoint.offset, focusPoint.type);
  selection.format = format;
  $setSelection(selection);
}
