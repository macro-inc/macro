import { $dfsIterator } from '@lexical/utils';
import {
  $applyNodeReplacement,
  $createTextNode,
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  type EditorConfig,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type NodeMutation,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from 'lexical';
import { $applyIdFromSerialized } from '../plugins/nodeIdPlugin';
import {
  $applyPeerIdFromSerialized,
  $isNodePeerIdValid,
  isNodePeerIdValid,
  type PeerIdValidator,
} from '../plugins/peerIdPlugin';
import { $isChildOfCode, isEmptyOrMatches } from '../utils';

export type SerializedInlineSearchNode = Spread<
  SerializedTextNode,
  { type: 'inline-search' }
>;

export enum InlineSearchNodesType {
  Mentions = '@',
  Emojis = ':',
  Actions = '/',
}

export const SEARCH_NODE_TYPE_VALUES = {
  [InlineSearchNodesType.Mentions]: '@@',
  [InlineSearchNodesType.Emojis]: '::',
  [InlineSearchNodesType.Actions]: '//',
};

export function validTriggerPosition(
  editor: LexicalEditor,
  before: RegExp = /\s$/,
  after: RegExp = /^\s/
) {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return false;
    const anchorNode = selection?.anchor.getNode();
    if (!anchorNode) return false;
    if ($isInlineSearchNode(anchorNode)) return false;
    if ($isChildOfCode(anchorNode)) return false;

    const beforeText = anchorNode
      .getTextContent()
      .slice(0, selection.anchor.offset);

    if (beforeText.endsWith('`')) {
      return false;
    }

    if (!isEmptyOrMatches(beforeText, before)) {
      return false;
    }

    const afterText = anchorNode
      .getTextContent()
      .slice(selection.anchor.offset);
    return isEmptyOrMatches(afterText, after);
  });
}

const CLEAN_REGEX = /^[@|:|\/]/g; // Matches @, :, or / to clean the search term.

export class InlineSearchNode extends TextNode {
  static getType() {
    return 'inline-search';
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  static clone(node: InlineSearchNode) {
    return new InlineSearchNode(node.__text, node.__key);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config);
    let className = config.theme['inline-search'];
    element.className = className;
    return element;
  }

  exportJSON(): SerializedInlineSearchNode {
    return {
      ...super.exportJSON(),
      type: 'inline-search',
      version: 1,
    };
  }
  updateFromJSON(serializedNode: SerializedTextNode): this {
    super.updateFromJSON(serializedNode);
    $applyIdFromSerialized(this, serializedNode);
    $applyPeerIdFromSerialized(this, serializedNode);
    return this;
  }
  static importJSON(serializedNode: SerializedInlineSearchNode) {
    const node = $createInlineSearchNode(serializedNode.text);
    return node.updateFromJSON(serializedNode);
  }
}

// When the user types @, we first make a new inline search node with
// the text '@' that then captures the user-typed '@'.
export function $handleInlineSearchNodeTransform(
  node: InlineSearchNode,
  type: InlineSearchNodesType
) {
  const text = node.getTextContent();
  if (text.startsWith(SEARCH_NODE_TYPE_VALUES[type])) {
    node.setTextContent(text.slice(1));
    node.selectEnd();
  }
}

/**
 * Handles the mutation of an inline search node depending on its type
 * example: if the type is @, then the mutation will be handled by the
 * mentions plugin.
 */
export function $handleInlineSearchNodeMutation(
  editor: LexicalEditor,
  prevEditorState: EditorState,
  mutatedNodes: Map<string, NodeMutation>,
  type: InlineSearchNodesType,
  actions: {
    onDestroy: () => void;
    onCreate: () => void;
    onUpdate: (search: string) => void;
  },
  peerIdValidator?: PeerIdValidator
) {
  for (const [nodeKey, mutation] of mutatedNodes) {
    // If we are in live-collaboration mode, we need to ensure that the peerId on the node
    // is the same as the current peerId of the user.
    if (mutation === 'destroyed') {
      if (isNodePeerIdValid(prevEditorState, nodeKey, peerIdValidator)) {
        actions.onDestroy();
      }
    } else if (mutation === 'created') {
      editor.read(() => {}); // Node wont exist without flush.
      const state = editor.getEditorState();
      if (isNodePeerIdValid(state, nodeKey, peerIdValidator)) {
        const search = state.read(() =>
          $getNodeByKey(nodeKey)?.getTextContent()
        );
        if (!search || search !== type) return;
        actions.onCreate();
      }
    } else if (mutation === 'updated') {
      editor.read(() => {}); // Node wont have state until flush.
      const state = editor.getEditorState();
      if (isNodePeerIdValid(state, nodeKey, peerIdValidator)) {
        const search = state.read(() =>
          $getNodeByKey(nodeKey)?.getTextContent()
        );
        if (search) {
          let cleanedSearch = search.trim().replace(CLEAN_REGEX, '');
          actions.onUpdate(cleanedSearch);
        }
      }
    }
  }
}

export function $createInlineSearchNode(text?: string) {
  const node = new InlineSearchNode(text ?? '');
  const sel = $getSelection();
  if ($isRangeSelection(sel)) {
    node.setFormat(sel.format);
  }
  return $applyNodeReplacement(node);
}

export function $isInlineSearchNode(
  node: LexicalNode | null | undefined
): node is InlineSearchNode {
  return node instanceof InlineSearchNode;
}

/**
 * Collapses all inline search nodes in the editor, replacing them with regular text nodes.
 * This is used when escaping or exiting the inline search menu.
 */
export function $collapseInlineSearch(peerIdValidator?: PeerIdValidator) {
  let didReplaceNode = false;
  for (const { node } of $dfsIterator()) {
    if (
      $isInlineSearchNode(node) &&
      $isNodePeerIdValid(node, peerIdValidator)
    ) {
      didReplaceNode = true;
      node.replace($createTextNode(node.getTextContent()));
    }
  }
  return didReplaceNode;
}

/**
 * Removes all inline search nodes in the editor. This is used for clearing out the inline search
 * before inserting a mention.
 */
export function $removeInlineSearch(peerIdValidator?: PeerIdValidator) {
  let didRemove = false;
  for (const { node } of $dfsIterator()) {
    if (
      $isInlineSearchNode(node) &&
      $isNodePeerIdValid(node, peerIdValidator)
    ) {
      didRemove = true;
      node.remove();
    }
  }
  return didRemove;
}
