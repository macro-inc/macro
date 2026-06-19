import { $convertFromMarkdownString } from '@lexical/markdown';
import {
  $getRoot,
  createEditor,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import { SupportedNodeTypes } from '../../node-list';
import {
  $updateAllNodeIds,
  nodeIdPlugin,
  type NodeIdMappings,
} from '../../plugins/nodeIdPlugin';
import { XML_TRANSFORMERS } from '../../transformers/xml';

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
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  nodeIdPlugin({ nodes: SupportedNodeTypes, mappings: ids })(editor);
  return { editor, ids };
}

/** Load a document from markdown, replacing any existing content. */
export function loadMarkdown(s: Session, md: string): void {
  s.editor.update(
    () => {
      $getRoot().clear();
      $convertFromMarkdownString(md, XML_TRANSFORMERS);
    },
    { discrete: true }
  );
  // Ensure every node has an id (and is in the mappings) even if a transform
  // somehow missed it.
  s.editor.update(
    () => {
      $updateAllNodeIds(s.ids);
    },
    { discrete: true }
  );
}

/** Load a document from a serialized editor-state snapshot. */
export function loadSnapshot(s: Session, raw: SerializedEditorState): void {
  const state = s.editor.parseEditorState(raw);
  s.editor.setEditorState(state);
  s.editor.update(
    () => {
      $updateAllNodeIds(s.ids);
    },
    { discrete: true }
  );
}

/** Export the current document as a serialized editor-state snapshot. */
export function toSnapshot(s: Session): SerializedEditorState {
  return s.editor.getEditorState().toJSON();
}
