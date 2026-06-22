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
import { INTERNAL_TRANSFORMERS } from '../../transformers';

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

/** Walk a raw snapshot and fix any heading nodes that are missing a `tag` field.
 *  The @lexical/markdown exporter calls `getTag().slice()` unconditionally, so a
 *  null tag produces a TypeError before the AI even sees the document. */
function sanitizeSnapshot(raw: SerializedEditorState): SerializedEditorState {
  function walk(node: any): any {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(walk);
    const out = { ...node };
    if (out.type === 'heading' && !out.tag) out.tag = 'h1';
    if (out.children) out.children = out.children.map(walk);
    return out;
  }
  return { ...(raw as any), root: walk((raw as any).root) };
}

/** Load a document from a serialized editor-state snapshot. */
export function loadSnapshot(s: Session, raw: SerializedEditorState): void {
  const state = s.editor.parseEditorState(sanitizeSnapshot(raw));
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
