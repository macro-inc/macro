import type { LoroManager } from '@core/collab/manager';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { isErr } from '@core/util/maybeResult';
import { $getNodeById, type NodeIdMappings } from '@lexical-core';
import {
  $createPoint,
  $createRangeSelection,
  $getNodeByKey,
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

    if (isErr(firstContainerResult)) {
      warn('Failed to get first container', firstContainerResult);
      return undefined;
    }

    const firstContainer = firstContainerResult[1];
    if (firstContainer instanceof LoroText) {
      anchorCursor = firstContainer.getCursor(0);
    } else if (firstContainer instanceof LoroMovableList) {
      anchorCursor = firstContainer.getCursor(0);
    }

    // Create cursor at the end of the last node
    const lastContainerResult = loroManager.getContainerById(lastContainerId);

    if (isErr(lastContainerResult)) {
      warn('Failed to get last container', lastContainerResult);
      return undefined;
    }

    const lastContainer = lastContainerResult[1];

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
  if (isErr(maybeContainer)) {
    warn('Failed to get container', maybeContainer);
    return undefined;
  }

  let container = maybeContainer[1];

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
    } else {
      // If the container is not a text container,
      // we use the cursor offset within the movable list instead of inside the text container
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

  if (isErr(maybeContainer)) {
    warn('Failed to get container', maybeContainer);
    return null;
  }

  if (!maybeContainer[1]) {
    warn("no container for cursor's containe id");
    return null;
  }

  const nodeKey = node.getKey();

  // Get position info from the cursor
  const posResult = loroManager.getCursorPos(cursor.cursor);

  if (isErr(posResult)) {
    warn('Failed to get cursor position', posResult);
    return null;
  }

  let pos = posResult[1];

  // Create a Point for the Lexical node
  return $createPointFromKeyAndOffset(nodeKey, pos.offset);
}

export function $createPointFromKeyAndOffset(
  nodeKey: NodeKey,
  offset: number
): Point | null {
  const node = $getNodeByKey(nodeKey);

  if (!node) {
    return null;
  }

  // Determine the appropriate type based on the node type
  let type: 'text' | 'element' | 'root';

  if ($isTextNode(node) || node.getType() === 'inline-search') {
    type = 'text';
  } else {
    type = 'element';
  }

  offset = type === 'text' ? offset : 0;

  return $createPoint(nodeKey, offset, type);
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
