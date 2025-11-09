import {
  $getNodeById,
  $getPeerId,
  $setLocal,
  isSerializedImageNode,
  isSerializedVideoNode,
  type NodeIdMappings,
} from '@lexical-core';
import deepEqual from 'fast-deep-equal';
import {
  $getEditor,
  $isElementNode,
  $parseSerializedNode,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from 'lexical';

type NodeWithChildren = {
  children: SerializedLexicalNode[];
} & SerializedLexicalNode;

type NodeWithCustomId = { $: { id: string } } & SerializedLexicalNode;
type NodeWithPeerId = {
  $: { peerId: string; local: boolean };
} & SerializedLexicalNode;

// Improved type guards with clearer naming
function hasChildren(node: SerializedLexicalNode): node is NodeWithChildren {
  return 'children' in node && Array.isArray(node.children);
}

function hasCustomId(node: SerializedLexicalNode): node is NodeWithCustomId {
  return '$' in node && 'id' in node.$!;
}

function _hasPeerId(
  node: SerializedLexicalNode | Partial<SerializedLexicalNode>
): node is NodeWithPeerId {
  return '$' in node && 'peerId' in node.$!;
}

function getNodeId(node: SerializedLexicalNode): string | undefined {
  if (hasCustomId(node)) {
    return node.$.id;
  }
  return undefined;
}

/** Get a node's value that is safe to compare between updates */
function getComparableNodeValue(
  node: SerializedLexicalNode
): Record<string, any> {
  if (isSerializedImageNode(node) || isSerializedVideoNode(node)) {
    // NOTE: dss image urls have a bunch of generated query params that we don't want to compare
    return {
      ...node,
      url: node.srcType === 'dss' ? undefined : node.url,
    };
  }
  return {
    ...node,
    children: undefined,
  };
}

// Map of a nodeId -> parent nodeId. If parent is undefined, it means the node is the root node
type ParentMap = Map<string, string | undefined>;

function buildParentMap(
  node: SerializedLexicalNode,
  parentId: string | undefined,
  out: ParentMap
) {
  const id = getNodeId(node);
  if (id) out.set(id, parentId);
  if (hasChildren(node)) {
    for (const child of node.children) {
      buildParentMap(child, id, out);
    }
  }
}

/**
 * Reconcile changes between two editor states
 * Recursively diff and apply changes between nodes
 *
 * @param oldState - Old editor state
 * @param newState - New editor state
 * @param mapping - LoroNodeMapping instance
 */
export function $reconcileLexicalState(
  oldState: SerializedEditorState,
  newState: SerializedEditorState,
  mapping: NodeIdMappings,
  peerId: () => string
): void {
  const editor = $getEditor();

  const newParentMap = new Map<string, string | undefined>();
  const oldParentMap = new Map<string, string | undefined>();
  buildParentMap(newState.root, undefined, newParentMap);
  buildParentMap(oldState.root, undefined, oldParentMap);

  $applyChildren(
    editor,
    mapping,
    oldState.root,
    newState.root,
    oldParentMap,
    newParentMap,
    peerId
  );
}

// Mark incoming tracked peerId nodes with correct local status.
function $applyLocalStatus(node: LexicalNode, peerId: () => string) {
  const nodePeerId = $getPeerId(node);
  if (nodePeerId) {
    $setLocal(node, nodePeerId === peerId());
  }
}

// Apply state changes to a specific node
function $applyNodeState(
  editor: LexicalEditor,
  mapping: NodeIdMappings,
  nodeId: string,
  state: Partial<SerializedLexicalNode>,
  peerId: () => string
): void {
  const node = $getNodeById(editor, mapping.idToNodeKeyMap, nodeId);
  if (!node) {
    console.error('Node not found for ID:', nodeId);
    return;
  }

  try {
    // Update the node with new state and mark it as dirty to trigger re-render
    const newNode = node.updateFromJSON(state);
    $applyLocalStatus(newNode, peerId);
    newNode.markDirty();
  } catch (error) {
    console.error(`Failed to update node ${nodeId}:`, error);
  }
}

function moveNodeIfNeeded(
  parent: ElementNode,
  node: LexicalNode,
  targetIndex: number
): void {
  const currentIndex = parent.getChildren().indexOf(node);
  if (currentIndex !== -1 && currentIndex !== targetIndex) {
    parent.splice(currentIndex, 1, []);
    parent.splice(targetIndex, 0, [node]);
  }
}

function moveNodeBetweenParents(
  editor: LexicalEditor,
  mapping: NodeIdMappings,
  parent: ElementNode,
  node: LexicalNode,
  oldParentId: string,
  targetIndex: number
) {
  const oldParent = oldParentId
    ? $getNodeById(editor, mapping.idToNodeKeyMap, oldParentId)
    : null;
  if (oldParent && $isElementNode(oldParent)) {
    const oldIndex = oldParent.getChildren().indexOf(node);
    if (oldIndex !== -1) {
      oldParent.splice(oldIndex, 1, []);
    }
  }

  parent.splice(targetIndex, 0, [node]);
}

/** Diff and apply changes between two sets of nodes
 *
 * @param editor - Lexical editor instance
 * @param mapping - LoroNodeMapping instance
 * @param oldNode - Old node to diff against
 * @param newNode - New node to diff against
 */
function $applyChildren(
  editor: LexicalEditor,
  mapping: NodeIdMappings,
  oldNode: NodeWithChildren,
  newNode: NodeWithChildren,
  oldParentMap: ParentMap,
  newParentMap: ParentMap,
  peerId: () => string
): void {
  const oldChildren = oldNode.children;
  const newChildren = newNode.children;
  const parentId = getNodeId(oldNode as any);
  const parent = parentId
    ? $getNodeById(editor, mapping.idToNodeKeyMap, parentId)
    : null;

  if (!parent || !$isElementNode(parent)) {
    console.error(
      'Parent node notOD found or is not an ElementNode during reconciliation'
    );
    return;
  }

  const oldIdToIndex = new Map<string, number>();
  const newIdToIndex = new Map<string, number>();

  for (let i = 0; i < oldChildren.length; i++) {
    const id = getNodeId(oldChildren[i]);
    if (id) oldIdToIndex.set(id, i);
  }
  for (let i = 0; i < newChildren.length; i++) {
    const id = getNodeId(newChildren[i]);
    if (id) newIdToIndex.set(id, i);
  }

  // Remove nodes that arent present in the newChildren array first
  for (let i = oldChildren.length - 1; i >= 0; i--) {
    const id = getNodeId(oldChildren[i]);
    if (!id || !newIdToIndex.has(id)) {
      const oldSize = parent.getChildrenSize();
      if (i < oldSize) parent.splice(i, 1, []);
    }
  }

  for (let newIndex = 0; newIndex < newChildren.length; newIndex++) {
    const newChild = newChildren[newIndex];
    const id = getNodeId(newChild);

    let node = id ? $getNodeById(editor, mapping.idToNodeKeyMap, id) : null;

    // Node already exists, check for move / update
    if (node && id) {
      const oldParentId = oldParentMap.get(id);
      const newParentId = newParentMap.get(id);

      // Handle cross-parent move
      if (oldParentId && newParentId && oldParentId !== newParentId) {
        moveNodeBetweenParents(
          editor,
          mapping,
          parent,
          node,
          oldParentId,
          newIndex
        );
        continue;
      }

      let nodeIndex = parent.getChildren().indexOf(node);

      if (nodeIndex !== -1 && nodeIndex !== newIndex) {
        moveNodeIfNeeded(parent, node, newIndex);
      }

      // Node exists in old and new children
      const oldIdx = oldIdToIndex.get(id!);
      if (oldIdx !== undefined) {
        const oldChildValue = getComparableNodeValue(oldChildren[oldIdx]);
        const newChildValue = getComparableNodeValue(newChild);
        // Node has a value change
        if (!deepEqual(oldChildValue, newChildValue)) {
          $applyNodeState(editor, mapping, id!, newChildValue, peerId);
        }
      }

      // Recurse all children if they exist
      if (hasChildren(newChild)) {
        const oldIdx = oldIdToIndex.get(id!);
        if (oldIdx !== undefined && hasChildren(oldChildren[oldIdx])) {
          $applyChildren(
            editor,
            mapping,
            oldChildren[oldIdx] as NodeWithChildren,
            newChild as NodeWithChildren,
            oldParentMap,
            newParentMap,
            peerId
          );
        }
      }
    } else {
      // Insert new node
      const newNodeInstance = $parseSerializedNode(newChild);
      parent.splice(newIndex, 0, [newNodeInstance]);
    }
  }
}
