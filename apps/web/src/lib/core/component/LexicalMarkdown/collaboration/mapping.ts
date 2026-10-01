import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { AutomergeMap, type ContainerID } from '@macro-inc/automerge';
import type { AutomergeManager } from '@macro-inc/collaboration/collab/manager';
import type { NodeIdMappings } from '@macro-inc/lexical-core';
import { $getNodeByKey, type LexicalNode } from 'lexical';

const warn = (...args: any[]) => {
  if (DEV_MODE_ENV) console.warn('AutomergeNodeMappings:', ...args);
};

/** Finds the [LexicalNode] for the given [AutomergeDoc] and [AutomergeLexicalNodeMappings]
 *
 * @param automergeManager The [AutomergeDoc] to search
 * @param mappings The [AutomergeLexicalNodeMappings] to search
 * @param containerId The [ContainerID] to search
 */
function _$findLexicalNodeForAutomergeContainer(
  automergeManager: AutomergeManager,
  mappings: NodeIdMappings,
  containerId: ContainerID
): LexicalNode | null {
  let maybeContainer = automergeManager.getContainerById(containerId);

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

  if (!(container instanceof AutomergeMap)) {
    if (!container.parent) {
      warn('no parent for text');
      return null;
    }
    container = container.parent()?.getAttached() as AutomergeMap;
  }

  const idMap = (container as AutomergeMap).getOrCreateContainer(
    '$',
    new AutomergeMap()
  );

  const value = idMap.getShallowValue();

  const nodeId = value.id as string;

  if (!nodeId) return null;

  const nodeKey = mappings.idToNodeKeyMap.get(nodeId);

  if (!nodeKey) return null;

  return $getNodeByKey(nodeKey);
}

/** Finds the given automerge container's [ContainerID] given the node id
 *
 * @param automergeManager The [AutomergeDoc] to search
 * @param node The [LexicalNode] to search
 * @param mappings The [AutomergeLexicalNodeMappings] to search
 */
export function $findAutomergeContainerForLexicalNode(
  automergeManager: AutomergeManager,
  node: LexicalNode,
  mappings: NodeIdMappings
): ContainerID | null {
  const nodeKey = node.getKey();
  const nodeId = mappings.nodeKeyToIdMap.get(nodeKey);

  if (!nodeId) {
    warn('no node id');
    return null;
  }

  const containerId = smartSearchContainersForNode(automergeManager, nodeId);

  if (!containerId) {
    // %BOOKMARK - no container
    warn('no container id for node key', nodeKey, 'and id', nodeId);
    return null;
  }

  return containerId;
}

function getMapValueOrContainer(
  container: AutomergeMap,
  key: string
): Record<string, any> {
  const maybeContainer = container.get(key);
  if (maybeContainer instanceof AutomergeMap) {
    return maybeContainer.getShallowValue();
  } else if (typeof maybeContainer === 'object' && maybeContainer !== null) {
    return maybeContainer;
  }
  return {};
}

function smartSearchContainersForNode(
  automergeManager: AutomergeManager,
  nodeId: string
): ContainerID | undefined {
  const res = automergeManager.getAllContainerIds();

  if (res.isErr()) {
    warn('Failed to get all container ids', res);
    return undefined;
  }

  const containerIds: ContainerID[] = res.value.reverse();

  for (const containerId of containerIds) {
    const maybeContainer = automergeManager.getContainerById(containerId);

    if (maybeContainer.isErr()) {
      warn('Failed to get container', maybeContainer);
      return undefined;
    }

    let container = maybeContainer.value;

    container = container?.getAttached();

    if (!container || !(container instanceof AutomergeMap)) continue;

    const innerValue = getMapValueOrContainer(container, '$');

    if (!('id' in innerValue)) {
      continue;
    }

    const innerNodeId = innerValue.id as string;

    if (innerNodeId === nodeId) {
      return containerId;
    }
  }

  return undefined;
}
