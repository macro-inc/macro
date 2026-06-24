import { registerCodeHighlighting } from '@lexical/code';
import { $convertFromMarkdownString } from '@lexical/markdown';
import {
  $getRoot,
  createEditor,
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

export type Session = {
  editor: LexicalEditor;
  ids: NodeIdMappings;
};

export function createEditingSession(): Session {
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
export function loadMarkdown(session: Session, md: string): void {
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
  session: Session,
  raw: SerializedEditorState
): void {
  const state = session.editor.parseEditorState(raw);
  session.editor.setEditorState(state);
  session.editor.update(
    () => {
      $updateAllNodeIds(session.ids);
    },
    { discrete: true }
  );
}

/** Export the current document as a serialized editor-state snapshot. */
export function toSnapshot(session: Session): SerializedEditorState {
  return session.editor.getEditorState().toJSON();
}
