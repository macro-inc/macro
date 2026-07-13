import { $dfsIterator, mergeRegister } from '@lexical/utils';
import {
  $getNodeByKey,
  $getRoot,
  $getState,
  $isElementNode,
  $setState,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_NORMAL,
  createCommand,
  createState,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type MutationListener,
  NODE_STATE_KEY,
  type NodeKey,
  type NodeMutation,
  SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
  type SerializedLexicalNode,
} from 'lexical';
import { nanoid } from 'nanoid';

/*
 * Bidirectional lookup translating between durable NodeIds (managed by us) and ephemeral
 * NodeKeys (manages by Lexical) that is managed by the nodeIdPlugin.
 */
export type NodeIdMappings = {
  idToNodeKeyMap: Map<string, NodeKey>;
  nodeKeyToIdMap: Map<NodeKey, string>;
};

/**
 * Dispatch this command to initialize a newly created editor state with
 * node ids.
 */
export const INITIALIZE_DOCUMENT_IDS = createCommand<void>(
  'INITIALIZE_DOCUMENT_IDS '
);

export const idState = createState('id', {
  parse: (value) => (typeof value === 'string' ? value : null),
});

/**
 * Get the id of a node.
 */
export function $getId(node: LexicalNode) {
  return $getState(node, idState);
}

/**
 * Set the id of a node.
 */
export function $setId(node: LexicalNode, id: string) {
  $setState(node, idState, id);
}

/**
 * Regenerate the id of a node and set it - useful for handling
 * id collisions.
 */
export function $regenId(node: LexicalNode, length: number) {
  let id = nanoid(length);
  $setId(node, id);
  return id;
}

/**
 * Apply the id from a serialized node to a node.
 */
export function $applyIdFromSerialized<
  T extends LexicalNode,
  U extends SerializedLexicalNode,
>(node: T, serialized: U) {
  const id = serialized[NODE_STATE_KEY]?.id;
  if (id && typeof id === 'string') {
    $setId(node, id);
  }
}

/**
 * Invalidate the id of a node and all of its children - that way the
 * node transform listeners will be called again.
 */
export const $invalidateId = (node: LexicalNode) => {
  $setState(node, idState, null);
  if ($isElementNode(node)) {
    node.getChildren().forEach((child) => {
      $invalidateId(child);
    });
  }
};

/**
 * Assert the id of a node or create it if it doesn't exist.
 */
export const $assertId = (node: LexicalNode, size: number) => {
  const id = $getId(node);
  if (!id) {
    let _id = nanoid(size);
    $setState(node, idState, _id);
    return _id;
  }
  return id;
};

export type NodeIdProps = {
  nodes: ReadonlyArray<Klass<LexicalNode>>;
  idLength?: number;
  mappings: NodeIdMappings;
};

function registerNodeIdPlugin(editor: LexicalEditor, props: NodeIdProps) {
  const idLength = props.idLength ?? 11;

  const nodeList = props.nodes.filter((n) => editor.hasNode(n));

  const cleanupHandlers: Array<() => void> = [];

  const createNodeTransform = () => {
    return (node: LexicalNode) => {
      const { idToNodeKeyMap, nodeKeyToIdMap } = props.mappings;
      let id = $assertId(node, idLength);
      if (idToNodeKeyMap.has(id) && idToNodeKeyMap.get(id) !== node.getKey()) {
        id = $regenId(node, idLength);
      }
      const nodeKey = node.getKey();
      idToNodeKeyMap.set(id, nodeKey);
      nodeKeyToIdMap.set(nodeKey, id);
    };
  };

  const createMutationListener = (): MutationListener => {
    return (nodes: Map<NodeKey, NodeMutation>, { prevEditorState }) => {
      const { idToNodeKeyMap, nodeKeyToIdMap } = props.mappings;
      const createdNodes: Array<NodeKey> = [];
      prevEditorState.read(() => {
        for (const [key, mutation] of nodes.entries()) {
          const node = $getNodeByKey(key);
          if (mutation === 'created') {
            createdNodes.push(key);
          }

          if (mutation === 'destroyed') {
            const id = $getId(node!);
            if (id) {
              idToNodeKeyMap.delete(id);
              nodeKeyToIdMap.delete(node!.getKey());
            }
            return;
          }
        }
      });

      if (createdNodes.length > 0) {
        editor.update(() => {
          for (const key of createdNodes) {
            const node = $getNodeByKey(key);
            if (!node) continue;
            const id = $assertId(node, idLength);
            idToNodeKeyMap.set(id, node.getKey());
            nodeKeyToIdMap.set(node.getKey(), id);
          }
        });
      }
    };
  };

  for (const nodeClass of nodeList) {
    let supportedClass = nodeClass as Klass<LexicalNode>;

    cleanupHandlers.push(
      editor.registerNodeTransform(supportedClass, createNodeTransform())
    );

    cleanupHandlers.push(
      editor.registerMutationListener(
        supportedClass,
        createMutationListener(),
        { skipInitialization: false }
      )
    );
  }

  return mergeRegister(
    ...cleanupHandlers,

    editor.registerCommand(
      SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
      ({ nodes, selection }) => {
        nodes.forEach((node) => {
          $invalidateId(node);
        });
        selection.insertNodes(nodes);
        return true;
      },
      COMMAND_PRIORITY_CRITICAL
    ),

    editor.registerCommand(
      INITIALIZE_DOCUMENT_IDS,
      () => {
        editor.update(() => {
          $updateAllNodeIds(props.mappings);
        });
        return true;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

/**
 * Plugin to attach a unique id to each node. These ids a durable across the
 * serialization pipeline and can be used for features like lice sync.
 * @param props.idLength The length of the id to generate. Defaults to 11.
 * @param props.idMap A map of ids to node keys that will be managed by the plugin.
 *     Pass your own map in if you need external visibility of the ids.
 */
export function nodeIdPlugin(props: NodeIdProps) {
  return (editor: LexicalEditor) => registerNodeIdPlugin(editor, props);
}

/**
 * Get a Lexical node by its custom id.
 * @param editor The Lexical editor instance
 * @param id The custom id of the node
 * @returns The node if found, null otherwise
 */
export function $getNodeById(
  editor: LexicalEditor,
  idMap: Map<String, NodeKey>,
  id: string
): LexicalNode | null {
  if (!idMap.has(id)) {
    return null;
  }

  const nodeKey = idMap.get(id);

  if (!nodeKey) {
    return null;
  }

  return editor.getEditorState().read(() => {
    return $getNodeByKey(nodeKey);
  });
}

/**
 * Update all the node ids in the editor
 * @param mappings The mappings to update
 */
export function $updateAllNodeIds(
  mappings: NodeIdMappings,
  root?: LexicalNode
) {
  const startNode = root ?? $getRoot();
  const iterator = $dfsIterator(startNode);
  for (const { node } of iterator) {
    const id = $assertId(node, 8);
    mappings.idToNodeKeyMap.set(
      `${structuredClone(id)}`,
      structuredClone(node.getKey())
    );
    mappings.nodeKeyToIdMap.set(`${structuredClone(node.getKey())}`, id);
  }
}
