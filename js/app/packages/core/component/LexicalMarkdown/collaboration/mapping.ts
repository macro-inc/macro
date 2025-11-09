import type { LoroManager } from '@core/collab/manager';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { isErr } from '@core/util/maybeResult';
import type { NodeIdMappings } from '@lexical-core';
import { $getNodeByKey, type LexicalNode } from 'lexical';
import { type ContainerID, LoroMap } from 'loro-crdt';

const warn = (...args: any[]) => {
  if (DEV_MODE_ENV) console.warn('LoroNodeMappings:', ...args);
};

/** Finds the [LexicalNode] for the given [LoroDoc] and [LoroLexicalNodeMappings]
 *
 * @param loroManager The [LoroDoc] to search
 * @param mappings The [LoroLexicalNodeMappings] to search
 * @param containerId The [ContainerID] to search
 */
export function $findLexicalNodeForLoroContainer(
  loroManager: LoroManager,
  mappings: NodeIdMappings,
  containerId: ContainerID
): LexicalNode | null {
  let maybeContainer = loroManager.getContainerById(containerId);

  if (isErr(maybeContainer)) {
    warn('Failed to get container', maybeContainer);
    return null;
  }

  let container = maybeContainer[1];

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

  const containerId = smartSearchContainersForNode(loroManager, nodeId);

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

function smartSearchContainersForNode(
  loroManager: LoroManager,
  nodeId: string
): ContainerID | undefined {
  const res = loroManager.getAllContainerIds();

  if (isErr(res)) {
    warn('Failed to get all container ids', res);
    return undefined;
  }

  const containerIds: ContainerID[] = res[1].reverse();

  for (const containerId of containerIds) {
    const maybeContainer = loroManager.getContainerById(containerId);

    if (isErr(maybeContainer)) {
      warn('Failed to get container', maybeContainer);
      return undefined;
    }

    let container = maybeContainer[1];

    container = container?.getAttached();

    if (!container || !(container instanceof LoroMap)) continue;

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
