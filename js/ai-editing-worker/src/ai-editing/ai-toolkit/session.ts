import { $convertFromMarkdownString } from '@lexical/markdown';
import {
  $getRoot,
  createEditor,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../../../../lexical-core/node-list';
import {
  $updateAllNodeIds,
  nodeIdPlugin,
  type NodeIdMappings,
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
    // NodeReplacements activates CodeNode → CustomCodeNode substitution so that
    // $createCodeNode() yields 'custom-code', consistent with documents from Loro.
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
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
      $convertFromMarkdownString(md, INTERNAL_TRANSFORMERS);
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
