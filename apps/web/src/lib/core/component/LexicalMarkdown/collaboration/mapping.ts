import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';

import type { NodeIdMappings } from '@macro-inc/lexical-core';
import { $getNodeByKey, $isRootNode, type LexicalNode } from 'lexical';
import { type ContainerID, LoroMap, LoroMovableList } from 'loro-crdt';

const warn = (...args: any[]) => {
  if (DEV_MODE_ENV) console.warn('LoroNodeMappings:', ...args);
};

/** Finds the [LexicalNode] for the given [LoroDoc] and [LoroLexicalNodeMappings]
 *
 * @param loroManager The [LoroDoc] to search
 * @param mappings The [LoroLexicalNodeMappings] to search
 * @param containerId The [ContainerID] to search
 */
function _$findLexicalNodeForLoroContainer(
  loroManager: LoroManager,
  mappings: NodeIdMappings,
  containerId: ContainerID
): LexicalNode | null {
  let maybeContainer = loroManager.getContainerById(containerId);

  if (maybeContainer.isErr()) {
    warn('Failed to get container', maybeContainer);
    return null;
  }

  let container = maybeContainer.value;

  container = container?.getAttached();

  if (!container) {
    warn('no container for id', containerId);
    return null;
  }

  if (!(container instanceof LoroMap)) {
    if (!container.parent) {
      warn('no parent for text');
      return null;
    }
    container = container.parent()?.getAttached() as LoroMap;
  }

  const idMap = (container as LoroMap).getOrCreateContainer('$', new LoroMap());

  const value = idMap.getShallowValue();

  const nodeId = value.id as string;

  if (!nodeId) return null;

  const nodeKey = mappings.idToNodeKeyMap.get(nodeId);

  if (!nodeKey) return null;

  return $getNodeByKey(nodeKey);
}

/** Finds the given loro container's [ContainerID] given the node id
 *
 * @param loroManager The [LoroDoc] to search
 * @param node The [LexicalNode] to search
 * @param mappings The [LoroLexicalNodeMappings] to search
 */
export function $findLoroContainerForLexicalNode(
  loroManager: LoroManager,
  node: LexicalNode,
  mappings: NodeIdMappings
): ContainerID | null {
  const nodeKey = node.getKey();
  const nodeId = mappings.nodeKeyToIdMap.get(nodeKey);

  if (!nodeId) {
    warn('no node id');
    return null;
  }

  const containerId = $searchContainersForNode(loroManager, node, nodeId);

  if (!containerId) {
    // %BOOKMARK - no container
    warn('no container id for node key', nodeKey, 'and id', nodeId);
    return null;
  }

  return containerId;
}

function getMapValueOrContainer(
  container: LoroMap,
  key: string
): Record<string, any> {
  const maybeContainer = container.get(key);
  if (maybeContainer instanceof LoroMap) {
    return maybeContainer.getShallowValue();
  } else if (typeof maybeContainer === 'object' && maybeContainer !== null) {
    return maybeContainer;
  }
  return {};
}

function nodeIdOfMap(map: LoroMap): string | undefined {
  if (map.isDeleted()) return undefined;
  const innerValue = getMapValueOrContainer(map, '$');
  return 'id' in innerValue ? (innerValue.id as string) : undefined;
}

/** The container at the node's position in the Loro tree, if it holds the node. */
function $containerAtNodePath(
  loroManager: LoroManager,
  node: LexicalNode,
  nodeId: string
): ContainerID | undefined {
  const path: number[] = [];
  let current = node;
  while (!$isRootNode(current)) {
    const parent = current.getParent();
    if (!parent) return undefined;
    path.push(current.getIndexWithinParent());
    current = parent;
  }

  let map = loroManager.doc.getMap('root');
  for (const index of path.reverse()) {
    const children = map.get('children');
    if (!(children instanceof LoroMovableList)) return undefined;
    const child = children.get(index);
    if (!(child instanceof LoroMap)) return undefined;
    map = child;
  }

  return nodeIdOfMap(map) === nodeId ? map.id : undefined;
}

/**
 * Lexical and Loro trees line up except where local-only nodes (draft comment
 * marks) shift positions; only those lookups scan every container.
 */
function $searchContainersForNode(
  loroManager: LoroManager,
  node: LexicalNode,
  nodeId: string
): ContainerID | undefined {
  const atPath = $containerAtNodePath(loroManager, node, nodeId);
  if (atPath) return atPath;

  const res = loroManager.getAllContainerIds();

  if (res.isErr()) {
    warn('Failed to get all container ids', res);
    return undefined;
  }

  // Newest containers first, so a node re-created by undo or redo resolves to
  // its live container.
  for (const containerId of res.value.reverse()) {
    const maybeContainer = loroManager.getContainerById(containerId);

    if (maybeContainer.isErr()) {
      warn('Failed to get container', maybeContainer);
      return undefined;
    }

    const container = maybeContainer.value?.getAttached();

    if (container instanceof LoroMap && nodeIdOfMap(container) === nodeId) {
      return containerId;
    }
  }

  return undefined;
}
