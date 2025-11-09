import { $dfsIterator, mergeRegister } from '@lexical/utils';
import {
  $addUpdateTag,
  $getNodeByKey,
  $getRoot,
  $getState,
  $setState,
  COMMAND_PRIORITY_CRITICAL,
  createCommand,
  createState,
  type EditorState,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type MutationListener,
  NODE_STATE_KEY,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';
import { $isSerializedNode } from '../utils';

/**
 * An update tag that signifies this update only included updates to the local status of nodes.
 */
export const LOCAL_STATUS_TAG = 'local-status';

/**
 * PeerId lexical state config.
 */
export const peerIdState = createState('peerId', {
  parse: (value) => (typeof value === 'string' ? value : null),
});

/**
 * State config to support multiple peers "claiming" one node.
 */
export const sharedPeersState = createState<
  'sharedPeerIds',
  Array<string> | null
>('sharedPeerIds', {
  parse: (value) =>
    Array.isArray(value) && value.every((n) => typeof n === 'string')
      ? value
      : null,
});

export function $getPeerId(node: LexicalNode) {
  return $getState(node, peerIdState);
}

export function $setPeerId(node: LexicalNode, peerId: string) {
  $setState(node, peerIdState, peerId);
}

export function $assertPeerId(node: LexicalNode, peerId: string) {
  const existing = $getPeerId(node);
  if (existing === peerId) return;
  $setPeerId(node, peerId);
}

export function $getSharedPeers(node: LexicalNode) {
  return $getState(node, sharedPeersState);
}

export function $addSharedPeer(node: LexicalNode, peerId: string) {
  const primaryPeerId = $getPeerId(node);
  if (!primaryPeerId) {
    console.warn('Setting shared peer id with no primary peer id.');
    return;
  }
  if (primaryPeerId === peerId) {
    return;
  }

  const prev = $getSharedPeers(node);
  if (!prev) {
    $setState(node, sharedPeersState, [peerId]);
    return;
  }
  const set = new Set(prev);
  set.add(peerId);
  const next = Array.from(set);
  $setState(node, sharedPeersState, next);
}

export function $hasSharedPeer(node: LexicalNode, peerId: string) {
  const prev = $getSharedPeers(node);
  return Boolean(prev && prev.includes(peerId));
}

export function $applyPeerIdFromSerialized<
  T extends LexicalNode,
  U extends SerializedLexicalNode,
>(node: T, serialized: U) {
  const peerId = serialized[NODE_STATE_KEY]?.peerId;
  if (peerId && typeof peerId === 'string') {
    $setPeerId(node, peerId);
  }
  const sharedPeerIds = serialized[NODE_STATE_KEY]?.sharedPeerIds;
  if (sharedPeerIds && Array.isArray(sharedPeerIds)) {
    $setState(node, sharedPeersState, [...sharedPeerIds]);
  }
}

export const localState = createState('local', {
  parse: (value) => (typeof value === 'boolean' ? value : null),
});

export function $getLocal(node: LexicalNode) {
  return $getState(node, localState);
}

export function $setLocal(node: LexicalNode, isLocal: boolean) {
  $setState(node, localState, isLocal);
}

export const INITIALIZE_LOCAL_STATUS = createCommand<() => string | undefined>(
  'INITIALIZE_LOCAL_STATUS'
);

/**
 * Plugin to attach collab peer id to each instance of a node.
 */
export type PeerIdProps = {
  peerId: () => string | undefined;
  nodes: Array<Klass<LexicalNode>>;
};

function registerPeerIdPlugin(editor: LexicalEditor, props: PeerIdProps) {
  const cleanupHandlers: Array<() => void> = [];

  const nodeList = props.nodes.filter((n) => editor.hasNode(n));

  const createNodeTransform = () => {
    return (node: LexicalNode) => {
      const peerId = props.peerId();
      if (peerId) {
        const nodePeerId = $getPeerId(node);
        if (nodePeerId === null) {
          $setPeerId(node, peerId);
        } else {
          editor
            .getElementByKey(node.getKey())
            ?.classList.toggle('local', nodePeerId === peerId);
        }
      }
    };
  };

  const createMutationListener = (): MutationListener => {
    return (mutations) => {
      let createdNodes: NodeKey[] = [];
      for (const [nodeKey, mutation] of mutations) {
        if (mutation === 'created') createdNodes.push(nodeKey);
      }
      if (createdNodes.length > 0) {
        editor.update(() => {
          $addUpdateTag(LOCAL_STATUS_TAG);
          for (const key of createdNodes) {
            const node = $getNodeByKey(key);
            if (!node) continue;
            const nodePeerId = $getPeerId(node);
            const nodeLocalState = $getLocal(node);
            if (nodePeerId !== null && nodeLocalState === null) {
              $setLocal(node, nodePeerId === props.peerId());
            }
          }
        });
      }
    };
  };

  for (const nodeClass of nodeList) {
    cleanupHandlers.push(
      editor.registerNodeTransform(nodeClass, createNodeTransform()),
      editor.registerMutationListener(nodeClass, createMutationListener())
    );
  }

  const runCleanups = () => {
    for (let i = 0; i < cleanupHandlers.length; i++) {
      cleanupHandlers[i]();
    }
    cleanupHandlers.length = 0;
  };

  return mergeRegister(
    runCleanups,
    editor.registerCommand(
      INITIALIZE_LOCAL_STATUS,
      (peerId: () => string | undefined) => {
        $updateAllOwnership(peerId);
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    )
  );
}

export function peerIdPlugin(props: PeerIdProps) {
  return (editor: LexicalEditor) => registerPeerIdPlugin(editor, props);
}

export function $updateAllOwnership(
  peerId: () => string | undefined,
  root?: LexicalNode
) {
  const id = peerId();
  if (!id) return;
  const startNode = root ?? $getRoot();
  for (const { node } of $dfsIterator(startNode)) {
    const nodePeerId = $getPeerId(node);
    if (nodePeerId === null) return;
    if (nodePeerId === id) {
      $setState(node, localState, true);
    }
    $setState(node, localState, $hasSharedPeer(node, id));
  }
}

export function $removePeerId(node: LexicalNode, peerId: string): boolean {
  const currentOwnerId = $getPeerId(node);
  const sharedPeers = $getSharedPeers(node);

  // peerId matches owner and no shared peers - remove ownership completely
  if (currentOwnerId === peerId && (!sharedPeers || sharedPeers.length === 0)) {
    $setState(node, peerIdState, null);
    $setState(node, localState, null);
    return true;
  }

  // peerId matches owner and there are shared peers - promote first shared peer
  if (currentOwnerId === peerId && sharedPeers && sharedPeers.length > 0) {
    const newOwnerId = sharedPeers[0];
    const remainingSharedPeers = sharedPeers.slice(1);

    $setPeerId(node, newOwnerId);
    $setState(
      node,
      sharedPeersState,
      remainingSharedPeers.length > 0 ? remainingSharedPeers : null
    );
    $setState(node, localState, false);
    return false;
  }

  // peerId is not the owner but might be in shared peers
  if (
    currentOwnerId !== peerId &&
    sharedPeers &&
    sharedPeers.includes(peerId)
  ) {
    const updatedSharedPeers = sharedPeers.filter((id) => id !== peerId);
    $setState(
      node,
      sharedPeersState,
      updatedSharedPeers.length > 0 ? updatedSharedPeers : null
    );
    $setState(node, localState, false);
    return false;
  }

  return false;
}

export type PeerIdValidator = (
  node: LexicalNode | SerializedLexicalNode
) => boolean;

export function createPeerIdValidator(
  peerId: () => string | undefined,
  enabled = true
): PeerIdValidator {
  if (enabled === false) {
    return () => true;
  }

  return (node: LexicalNode | SerializedLexicalNode) => {
    let nodePeerId: string | undefined;
    if ($isSerializedNode(node)) {
      nodePeerId = (node.$ as any)?.peerId;
    } else {
      nodePeerId = $getPeerId(node) ?? undefined;
    }

    const currentPeerId = peerId();

    if (!nodePeerId && currentPeerId) {
      return false;
    }

    if (nodePeerId && currentPeerId) {
      return nodePeerId === currentPeerId;
    }

    return true;
  };
}

export function isNodePeerIdValid(
  editor: LexicalEditor | EditorState,
  nodeKey: string,
  validator?: PeerIdValidator
): boolean {
  if (!validator) return true;
  let node = editor.read(() => $getNodeByKey(nodeKey));
  const serializedNode = editor.read(() => node?.exportJSON());
  if (serializedNode) {
    return validator(serializedNode);
  }
  return true;
}

export function $isNodePeerIdValid(
  node: LexicalNode,
  validator?: PeerIdValidator
): boolean {
  if (!validator) return true;
  return validator(node);
}
