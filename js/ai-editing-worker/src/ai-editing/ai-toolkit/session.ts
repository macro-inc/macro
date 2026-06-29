import { registerCodeHighlighting } from '@lexical/code';
import { $convertFromMarkdownString } from '@lexical/markdown';
import {
  $createParagraphNode,
  $getRoot,
  createEditor,
  type ElementNode,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import {
  NodeReplacements,
  SupportedNodeTypes,
} from '../../../../lexical-core/node-list';
import {
  $updateAllNodeIds,
  type NodeIdMappings,
  nodeIdPlugin,
} from '../../../../lexical-core/plugins/nodeIdPlugin';
import { INTERNAL_TRANSFORMERS } from '../../../../lexical-core/transformers';

export type LexicalSession = {
  editor: LexicalEditor;
  ids: NodeIdMappings;
};

export function createEditingSession(): LexicalSession {
  const ids: NodeIdMappings = {
    idToNodeKeyMap: new Map(),
    nodeKeyToIdMap: new Map(),
  };
  const editor = createEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements], // code becomes custom code like how we do it on main frontend
    onError: (error) => {
      throw error;
    },
  });
  nodeIdPlugin({ nodes: SupportedNodeTypes, mappings: ids })(editor);
  // prism tokenizes code blocks into code-highlight nodes so highlighting is
  // baked into the doc even when no browser is connected (if a browser is
  // connected it will observe a lexical update and swap with tokenized).
  registerCodeHighlighting(editor);
  return { editor, ids };
}

/** Load a document from markdown, replacing any existing content. */
export function loadMarkdown(session: LexicalSession, md: string): void {
  session.editor.update(
    () => {
      $getRoot().clear();
      $convertFromMarkdownString(md, INTERNAL_TRANSFORMERS);
    },
    { discrete: true }
  );
  // Ensure every node has an id (and is in the mappings) even if a transform
  // somehow missed it.
  session.editor.update(
    () => {
      $updateAllNodeIds(session.ids);
    },
    { discrete: true }
  );
}

/** Load a document from a serialized editor-state snapshot. */
export function loadSnapshot(
  session: LexicalSession,
  raw: SerializedEditorState
): void {
  // Lexical forbids an empty root (setEditorState throws). A document can be
  // genuinely empty, so seed a single empty paragraph instead of crashing.
  if (raw.root.children.length === 0) {
    session.editor.update(
      () => {
        const root = $getRoot();
        root.clear();
        root.append($createParagraphNode());
      },
      { discrete: true }
    );
  } else {
    session.editor.setEditorState(session.editor.parseEditorState(raw));
  }
  session.editor.update(
    () => {
      $updateAllNodeIds(session.ids);
    },
    { discrete: true }
  );
}

/** Export the current document as a serialized editor-state snapshot. */
export function toSnapshot(session: LexicalSession): SerializedEditorState {
  return session.editor.getEditorState().toJSON();
}

/**
 * Retype a container node by swapping in a freshly-built replacement. The
 * replacement gets a FRESH durable id (Loro can't reshape a container in place —
 * reusing the id makes the change vanish on sync, a fresh id reads as a clean
 * delete + insert), and every id that pointed at the old node is forwarded to
 * the replacement. Children carry over via `replace(…, true)` with their own ids
 * intact. Backs `$setBlockType` and `$setListType`.
 *
 * This is specifically for retyping containers — NOT a generic node replace.
 * Inline wraps (`$wrapInBlock`) re-parent a node without minting a fresh id.
 */
export function $retypeContainer<T extends ElementNode>(
  session: LexicalSession,
  node: ElementNode,
  replacement: T
): T {
  const oldKey = node.getKey();
  node.replace(replacement, true);
  $updateAllNodeIds(session.ids, replacement);
  const { idToNodeKeyMap } = session.ids;
  const newKey = replacement.getKey();
  for (const [id, key] of idToNodeKeyMap) {
    if (key === oldKey) idToNodeKeyMap.set(id, newKey);
  }
  return replacement;
}
