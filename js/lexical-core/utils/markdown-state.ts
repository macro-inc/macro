import { createHeadlessEditor } from '@lexical/headless';
import { $convertFromMarkdownString } from '@lexical/markdown';
import type { SerializedEditorState } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import {
  $updateAllNodeIds,
  type NodeIdMappings,
} from '../plugins/nodeIdPlugin';
import { ALL_TRANSFORMERS } from '../transformers';

function createNodeIdMappings(): NodeIdMappings {
  return {
    idToNodeKeyMap: new Map(),
    nodeKeyToIdMap: new Map(),
  };
}

/**
 * Converts markdown to a serialized Lexical editor state and assigns durable
 * node ids to every node. This is the headless equivalent of the markdown block
 * migration path used by the app.
 */
export function markdownToSerializedEditorStateWithIds(
  markdown: string
): SerializedEditorState {
  const editor = createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
  });
  const mappings = createNodeIdMappings();

  editor.update(
    () => {
      $convertFromMarkdownString(markdown, ALL_TRANSFORMERS);
    },
    { discrete: true }
  );

  editor.update(
    () => {
      $updateAllNodeIds(mappings);
    },
    { discrete: true }
  );

  return editor.getEditorState().toJSON();
}
