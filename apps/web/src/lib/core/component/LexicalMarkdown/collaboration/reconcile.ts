import { $isListItemNode } from '@lexical/list';
import {
  $getNodeById,
  $getPeerId,
  $liftDraftCommentMarks,
  $restoreDraftCommentMarks,
  $setLocal,
  isSerializedImageNode,
  isSerializedVideoNode,
  type NodeIdMappings,
  stripDraftCommentMarks,
} from '@macro-inc/lexical-core';
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

// Improved type guards with clearer naming
function hasChildren(node: SerializedLexicalNode): node is NodeWithChildren {
  return 'children' in node && Array.isArray(node.children);
}

function hasCustomId(node: SerializedLexicalNode): node is NodeWithCustomId {
  return '$' in node && 'id' in node.$!;
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
  const value: Record<string, any> = { ...node, children: undefined };
  // A list item's indent is its nesting depth, which the tree already
  // carries; applying it would re-nest the item (ListItemNode.setIndent).
  if (node.type === 'listitem') value.indent = undefined;
  return value;
}

/** What one reconcile pass reads while it walks the new tree. */
type Reconcile = {
  editor: LexicalEditor;
  mapping: NodeIdMappings;
  /** The old serialized node for each id, wherever it sat in the old tree. */
  oldNodes: Map<string, SerializedLexicalNode>;
  peerId: () => string;
};

function indexNodesById(
  node: SerializedLexicalNode,
  out: Map<string, SerializedLexicalNode>
) {
  const id = getNodeId(node);
  if (id) out.set(id, node);
  if (hasChildren(node)) {
    for (const child of node.children) {
      indexNodesById(child, out);
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
  // The local draft comment mark is never synced, so it is lifted out while
  // the tree is compared with the shared state. Drafts that arrive in the
  // shared state were left behind by sessions that ended mid-draft.
  const drafts = $liftDraftCommentMarks();
  const oldRoot = stripDraftCommentMarks(oldState).root;
  const newRoot = stripDraftCommentMarks(newState).root;

  const reconcile: Reconcile = {
    editor: $getEditor(),
    mapping,
    oldNodes: new Map(),
    peerId,
  };
  indexNodesById(oldRoot, reconcile.oldNodes);

  $applyChildren(reconcile, oldRoot, newRoot);

  $restoreDraftCommentMarks(drafts);
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
  reconcile: Reconcile,
  nodeId: string,
  state: ReturnType<typeof getComparableNodeValue>
): void {
  const node = $getNodeById(
    reconcile.editor,
    reconcile.mapping.idToNodeKeyMap,
    nodeId
  );
  if (!node) {
    console.error('Node not found for ID:', nodeId);
    return;
  }

  try {
    // Update the node with new state and mark it as dirty to trigger re-render
    const newNode = node.updateFromJSON(
      $isListItemNode(node) ? { ...state, indent: node.getIndent() } : state
    );
    $applyLocalStatus(newNode, reconcile.peerId);
    newNode.markDirty();
  } catch (error) {
    console.error(`Failed to update node ${nodeId}:`, error);
  }
}

/** The live node holding this id, if it has the serialized node's type. */
function $getExistingNode(
  reconcile: Reconcile,
  id: string | undefined,
  type: string
): LexicalNode | null {
  if (!id) return null;
  const node = $getNodeById(
    reconcile.editor,
    reconcile.mapping.idToNodeKeyMap,
    id
  );
  return node?.getType() === type ? node : null;
}

/** Brings an existing node's own state and children up to its new serialized form. */
function $updateExistingNode(
  reconcile: Reconcile,
  id: string,
  newNode: SerializedLexicalNode
): void {
  const oldNode = reconcile.oldNodes.get(id);
  if (!oldNode) return;
  const newValue = getComparableNodeValue(newNode);
  if (!deepEqual(getComparableNodeValue(oldNode), newValue)) {
    $applyNodeState(reconcile, id, newValue);
  }
  if (hasChildren(oldNode) && hasChildren(newNode)) {
    $applyChildren(reconcile, oldNode, newNode);
  }
}

/**
 * Creates a node that is new to the editor. Descendants that already exist
 * elsewhere (a move into a new parent, such as list items a list-to-table
 * undo puts back into a recreated list) are moved in rather than parsed again,
 * so they keep their ids and stay mapped to the shared document.
 */
function $createNode(
  reconcile: Reconcile,
  serialized: SerializedLexicalNode
): LexicalNode {
  if (!hasChildren(serialized)) return $parseSerializedNode(serialized);
  const shell: NodeWithChildren = { ...serialized, children: [] };
  const node = $parseSerializedNode(shell);
  if (!$isElementNode(node)) return $parseSerializedNode(serialized);
  for (const child of serialized.children) {
    const id = getNodeId(child);
    const existing = $getExistingNode(reconcile, id, child.type);
    if (!existing || !id) {
      node.append($createNode(reconcile, child));
      continue;
    }
    node.append(existing);
    $updateExistingNode(reconcile, id, child);
  }
  return node;
}

/**
 * Removes the children of `parent` that the new state no longer lists there.
 * Nodes with ids are found by id: one may already have moved to a new parent.
 * Nodes without ids are matched by position, walking the live children
 * alongside the old ones.
 */
function $removeDroppedChildren(
  reconcile: Reconcile,
  parent: ElementNode,
  oldChildren: SerializedLexicalNode[],
  newChildren: SerializedLexicalNode[]
): void {
  const newIds = new Set<string>();
  for (const child of newChildren) {
    const id = getNodeId(child);
    if (id) newIds.add(id);
  }
  const dropped: LexicalNode[] = [];
  let child = parent.getFirstChild();
  for (const oldChild of oldChildren) {
    const live = child;
    child = child?.getNextSibling() ?? null;
    const id = getNodeId(oldChild);
    if (id && newIds.has(id)) continue;
    if (!id) {
      if (live) dropped.push(live);
      continue;
    }
    const node = $getNodeById(
      reconcile.editor,
      reconcile.mapping.idToNodeKeyMap,
      id
    );
    if (node?.getParent()?.is(parent)) dropped.push(node);
  }
  for (const node of dropped) node.remove(true);
}

/** Diff and apply changes between two sets of nodes
 *
 * @param reconcile - The pass's editor, mappings and indexes
 * @param oldNode - Old node to diff against
 * @param newNode - New node to diff against
 */
function $applyChildren(
  reconcile: Reconcile,
  oldNode: NodeWithChildren,
  newNode: NodeWithChildren
): void {
  const { editor, mapping } = reconcile;
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

  $removeDroppedChildren(reconcile, parent, oldChildren, newChildren);

  // The first `index` children are in place and `previous` is the last of
  // them. New nodes collect in `inserts` and go in with one splice per run,
  // since each splice walks to its index.
  let index = 0;
  let previous: LexicalNode | null = null;
  let inserts: LexicalNode[] = [];
  const flushInserts = () => {
    if (inserts.length === 0) return;
    parent.splice(index, 0, inserts);
    index += inserts.length;
    previous = inserts[inserts.length - 1];
    inserts = [];
  };

  for (const newChild of newChildren) {
    const id = getNodeId(newChild);
    const node = id ? $getNodeById(editor, mapping.idToNodeKeyMap, id) : null;

    if (!node || !id) {
      inserts.push($createNode(reconcile, newChild));
      continue;
    }

    flushInserts();
    // Read after any creates: one may have moved the old next sibling into
    // a new parent.
    const expected = previous
      ? previous.getNextSibling()
      : parent.getFirstChild();
    if (!node.is(expected)) {
      // Moved here from another parent or from later in this one: splice
      // detaches it from where it was.
      parent.splice(index, 0, [node]);
    }
    index++;
    previous = node;

    $updateExistingNode(reconcile, id, newChild);
  }
  flushInserts();
}
