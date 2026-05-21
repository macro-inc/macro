import type { BlockName } from '@core/block';
import { mergeRegister } from '@lexical/utils';
import { $getId, type NodeIdMappings } from '@lexical-core';
import {
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  type BaseSelection,
  COMMAND_PRIORITY_LOW,
  createCommand,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
} from 'lexical';

/**
 * Represents a highlightable location with anchor and focus points. Uses persistent ids
 * rather than the simpler node keys.
 */
export type PersistentLocation = {
  type: 'persistent';
  anchor: {
    id: string;
    offset: number;
  };
  focus: {
    id: string;
    offset: number;
  };
};

/**
 * Represents basically a saved selection. Because it uses node keys not ids, its persistence is
 * not guaranteed across editor updates.
 */
export type EphemeralLocation = {
  type: 'ephemeral';
  anchor: {
    key: NodeKey;
    offset: number;
  };
  focus: {
    key: NodeKey;
    offset: number;
  };
};

export type MarkdownLocation = PersistentLocation | EphemeralLocation;

function _$selectionToEphemeralLocation(
  selection: BaseSelection | null
): EphemeralLocation | null {
  if (!$isRangeSelection(selection) || selection.isCollapsed()) {
    return null;
  }
  return {
    type: 'ephemeral',
    anchor: {
      key: selection.anchor.key,
      offset: selection.anchor.offset,
    },
    focus: {
      key: selection.focus.key,
      offset: selection.focus.offset,
    },
  };
}

function _getNodesFromEphemeralLocation(
  editor: LexicalEditor,
  loc: EphemeralLocation
): [LexicalNode, LexicalNode] | null {
  return editor.read(() => {
    const anchorNode = $getNodeByKey(loc.anchor.key);
    const focusNode = $getNodeByKey(loc.focus.key);
    if (anchorNode && focusNode) {
      return [anchorNode, focusNode];
    }
    return null;
  });
}

/**
 * The serialized format of a PersitentLocation is:
 * anchorNodeId.anchorOffset,focusNodeId.focusOffset
 * or anchorAndFocusId.anchorOffset.focusOffset if the focusNodeId is the same as the anchorNodeId.
 */
function serializePersistentLocation(location: PersistentLocation) {
  if (location.focus.id === location.anchor.id) {
    return `${location.anchor.id}.${location.anchor.offset}.${location.focus.offset}`;
  }
  return `${location.anchor.id}.${location.anchor.offset},${location.focus.id}.${location.focus.offset}`;
}

/**
 * Parse a string into a persistentLocation object.
 * @param location
 * @returns A location or null. The location is only checked for existence not for valid and
 *    present anchor nodes.
 */
function deserializePersistentLocation(
  location: string
): PersistentLocation | null {
  if (location.includes(',')) {
    const [anchor, focus] = location.split(',');
    const [anchorNodeId, anchorOffsetStr] = anchor.split('.');
    const [focusNodeId, focusOffsetStr] = focus.split('.');
    if (!anchorNodeId || !focusNodeId || !anchorOffsetStr || !focusOffsetStr)
      return null;
    const anchorOffset = parseInt(anchorOffsetStr, 10);
    const focusOffset = parseInt(focusOffsetStr, 10);
    if (isNaN(anchorOffset) || isNaN(focusOffset)) return null;
    return {
      type: 'persistent',
      anchor: {
        id: anchorNodeId,
        offset: anchorOffset,
      },
      focus: {
        id: focusNodeId,
        offset: focusOffset,
      },
    };
  } else {
    const [nodeId, anchorOffsetStr, focusOffsetStr] = location.split('.');
    if (!nodeId || !anchorOffsetStr || !focusOffsetStr) {
      return null;
    }
    const anchorOffset = parseInt(anchorOffsetStr, 10);
    const focusOffset = parseInt(focusOffsetStr, 10);
    if (isNaN(anchorOffset) || isNaN(focusOffset)) return null;
    return {
      type: 'persistent',
      anchor: {
        id: nodeId,
        offset: anchorOffset,
      },
      focus: {
        id: nodeId,
        offset: focusOffset,
      },
    };
  }
}

function persistentLocationToSearchParams(location: PersistentLocation) {
  return new URLSearchParams({
    location: serializePersistentLocation(location),
  });
}

/**
 * Serializes a  into a format suitable for URL query parameters.
 * @param location - The highlight location to serialize
 * @returns A string in the format `anchor=<id>::<offset>&focus=<id>::<offset>`
 */
function _gerPersistentLocationString(location: PersistentLocation): string {
  return persistentLocationToSearchParams(location).toString();
}

/**
 * Deserializes a string into a location object
 * @param serialized - The serialized string from serializePersistentLocation
 * @returns A location object or undefined if the input is invalid
 */
export function parsePersistentLocation(
  serialized: string
): PersistentLocation | null {
  return deserializePersistentLocation(serialized);
}

function _locationCompare(a: PersistentLocation, b: PersistentLocation) {
  for (const key in a) {
    const k = key as keyof PersistentLocation;
    if (b[k] !== a[k]) return false;
  }
  return true;
}

/**
 * Scroll the editor to the location if it is valid.
 */
export const GO_TO_LOCATION_COMMAND = createCommand<
  PersistentLocation | undefined
>('GO_TO_LOCATION_COMMAND');

export const GO_TO_NODE_ID_COMMAND = createCommand<string>(
  'GO_TO_NODE_ID_COMMAND'
);

type LocationPluginProps = {
  mapping: NodeIdMappings;
  onGotoLocation?: (location: PersistentLocation) => void;
  revokeOptions?: {
    onRevokeLocation: (location: PersistentLocation) => void;
    selectionChange?: () => boolean;
    mutation?: () => boolean;
    timeout?: () => number;
  };
};

/**
 * Resolve a node id to its current node key. The cached id→key mapping can be
 * stale at the moment these commands are dispatched (e.g. right after document
 * load or a collab reconcile, before nodeIdPlugin's transforms have caught up),
 * so when the cached lookup misses we scan the live editor state and refresh
 * the cache. The scan is breadth-first because search results target top-level
 * children of root, so we usually find the match before descending.
 */
function $resolveNodeKeyForId(
  id: string,
  mapping: NodeIdMappings
): NodeKey | null {
  const cachedKey = mapping.idToNodeKeyMap.get(id);
  if (cachedKey !== undefined && $getNodeByKey(cachedKey) !== null) {
    return cachedKey;
  }

  const queue: LexicalNode[] = [$getRoot()];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if ($getId(node) === id) {
      const key = node.getKey();
      mapping.idToNodeKeyMap.set(id, key);
      mapping.nodeKeyToIdMap.set(key, id);
      return key;
    }
    if ($isElementNode(node)) {
      queue.push(...node.getChildren());
    }
  }

  return null;
}

function registerLocationPlugin(
  editor: LexicalEditor,
  props: LocationPluginProps
) {
  let location: PersistentLocation | null = null;
  return mergeRegister(
    editor.registerCommand(
      GO_TO_LOCATION_COMMAND,
      (payload) => {
        if (payload === undefined) {
          if (location && props.revokeOptions?.onRevokeLocation) {
            props.revokeOptions.onRevokeLocation(location);
          }
          location = null;
          return true;
        }

        const focusNodeKey = $resolveNodeKeyForId(
          payload.focus.id,
          props.mapping
        );
        if (!focusNodeKey) return false;
        const focusNode = $getNodeByKey(focusNodeKey);
        if (!focusNode) return false;
        const focusElem = editor.getElementByKey(focusNode.getKey());
        if (!focusElem) return false;

        location = payload;

        if (props.revokeOptions) {
          if (props.revokeOptions.timeout?.() !== undefined) {
            setTimeout(() => {
              location = null;
              props.revokeOptions?.onRevokeLocation(payload);
            }, props.revokeOptions.timeout?.());
          }
        }

        focusElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        props.onGotoLocation?.(payload);
        return true;
      },
      COMMAND_PRIORITY_LOW
    ),

    editor.registerCommand(
      GO_TO_NODE_ID_COMMAND,
      (id) => {
        const nodeKey = $resolveNodeKeyForId(id, props.mapping);
        if (nodeKey === null) return false;

        const scrollAndHighlight = (elem: HTMLElement) => {
          elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          elem.classList.add('highlighted');
          setTimeout(() => {
            elem.classList.remove('highlighted');
          }, 2000);
        };

        const elem = editor.getElementByKey(nodeKey);
        if (elem !== null) {
          scrollAndHighlight(elem);
          return true;
        }

        // The node exists in the editor state, but its DOM element hasn't been
        // reconciled yet (common on initial document load). Wait for the next
        // editor update and retry the scroll once the element is available.
        let unsub: (() => void) | undefined;
        const safetyTimeout = setTimeout(() => {
          unsub?.();
        }, 5000);
        unsub = editor.registerUpdateListener(() => {
          const retried = editor.getElementByKey(nodeKey);
          if (retried !== null) {
            scrollAndHighlight(retried);
            clearTimeout(safetyTimeout);
            unsub?.();
          }
        });
        return true;
      },
      COMMAND_PRIORITY_LOW
    ),

    editor.registerUpdateListener(
      ({ mutatedNodes, editorState, prevEditorState }) => {
        if (!location) return;
        if (
          props.revokeOptions?.mutation?.() &&
          mutatedNodes &&
          mutatedNodes?.size > 0
        ) {
          props.revokeOptions?.onRevokeLocation(location);
          location = null;
          return;
        }
        if (
          props.revokeOptions?.selectionChange?.() &&
          editorState._selection &&
          !editorState._selection.is(prevEditorState._selection)
        ) {
          props.revokeOptions?.onRevokeLocation(location);
          location = null;
        }
      }
    )
  );
}

/**
 * Register the location plugin for getting locations from selections and going to them later.
 * The nodeIdPlugin must be configured on the editor to use this plugin.
 * @param props.
 * @returns
 */
export function locationPlugin(props: LocationPluginProps) {
  return (editor: LexicalEditor) => registerLocationPlugin(editor, props);
}

function $getPersistenLocationFromSelection(
  selection: BaseSelection | null
): PersistentLocation | null {
  if (!$isRangeSelection(selection) || selection.isCollapsed()) {
    console.error('Currently location plugin only suppotys range selections.');
    return null;
  }
  const anchorNode = selection.anchor.getNode();
  const focusNode = selection.focus.getNode();
  const anchorId = $getId(anchorNode);
  const focusId = $getId(focusNode);
  if (!anchorId || !focusId) {
    console.error(
      'The NodeID plugin must be enabled to use the location plugin.'
    );
    return null;
  }
  const anchorOffset = selection.anchor.offset;
  const focusOffset = selection.focus.offset;
  return {
    type: 'persistent',
    anchor: { id: anchorId, offset: anchorOffset },
    focus: { id: focusId, offset: focusOffset },
  };
}

export function $getSelectionLocation() {
  const selection = $getSelection();
  if (!selection) return null;
  return $getPersistenLocationFromSelection(selection);
}

export function $getLocationUrl(blockName: BlockName, blockId: string) {
  const url = new URL(window.location.href);
  if (blockId) {
    url.pathname = `app/${blockName}/${blockId}`;
  }
  const location = $getSelectionLocation();
  const params = url.searchParams;
  for (const [key] of params.entries()) {
    params.delete(key);
  }
  if (location) {
    const newParams = persistentLocationToSearchParams(location);
    for (const [key, value] of newParams.entries()) {
      params.set(key, value.toString());
    }
  }
  return url.toString();
}
