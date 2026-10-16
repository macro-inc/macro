import { isDeepStrictEqual } from 'node:util';
import { $unwrapMarkNode } from '@lexical/mark';
import { $dfsIterator } from '@lexical/utils';
import { $isCommentNode } from '@macro-inc/lexical-core';
import {
  $getRoot,
  $isTextNode,
  NODE_STATE_KEY,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from 'lexical';
import { createEditor } from './editor';

/**
 * Node state that wrapping text in a comment mark rewrites: the split text
 * nodes are new nodes with their own id and author, so they carry none of
 * the original's identity.
 */
const IDENTITY_STATE_KEYS = ['id', 'peerId', 'sharedPeerIds', 'local'];

/**
 * Whether `after` differs from `before` only in its comment marks: adding,
 * removing or changing a mark is allowed, any other change to the document is
 * not. Throws when either state does not parse.
 */
export function isCommentOnlyChange(
  before: SerializedEditorState,
  after: SerializedEditorState
): boolean {
  return isDeepStrictEqual(
    contentWithoutComments(before),
    contentWithoutComments(after)
  );
}

function contentWithoutComments(state: SerializedEditorState) {
  const editor = createEditor();
  editor.setEditorState(
    editor.parseEditorState({
      ...state,
      root: withoutIdentityState(state.root),
    })
  );
  editor.update(
    () => {
      for (const { node } of [...$dfsIterator($getRoot())]) {
        if ($isCommentNode(node)) $unwrapMarkNode(node);
        // Text normalization only visits dirty nodes; dirtying every text node
        // merges the pieces a mark split off, and any split already stored.
        else if ($isTextNode(node)) node.markDirty();
      }
    },
    { discrete: true }
  );
  return editor.getEditorState().toJSON();
}

function withoutIdentityState<Node extends SerializedLexicalNode>(
  node: Node
): Node {
  const copy: Record<string, unknown> = { ...node };
  const nodeState = node[NODE_STATE_KEY];
  if (nodeState) {
    const kept = Object.fromEntries(
      Object.entries(nodeState).filter(
        ([key]) => !IDENTITY_STATE_KEYS.includes(key)
      )
    );
    if (Object.keys(kept).length > 0) copy[NODE_STATE_KEY] = kept;
    else delete copy[NODE_STATE_KEY];
  }
  if ('children' in node && Array.isArray(node.children)) {
    copy.children = node.children.map(withoutIdentityState);
  }
  return copy as Node;
}
