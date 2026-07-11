import { createHeadlessEditor } from '@lexical/headless';
import type { SerializedEditorState } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from '../node-list';
import { DiffTextNode } from '../nodes/DiffTextNode';
import {
  $updateAllNodeIds,
  type NodeIdMappings,
} from '../plugins/nodeIdPlugin';
import { applyDiffs } from './applyDiffs';
import type { Diff } from './diffTypes';

/**
 * Build the serialized state that renders a diff: load the BEFORE state into a
 * throwaway headless editor, rebuild the id -> nodeKey map from the serialized
 * `$.id` node-state, apply the diffs (inline DiffTextNodes), and serialize back
 * out. Feed the result to any editor that registers DiffTextNode (e.g. the
 * history overlay's MarkdownShell) as `initialState` to display it.
 *
 * We rebuild ids with `$updateAllNodeIds` directly rather than registering the
 * full `nodeIdPlugin`: headless editors reject `registerMutationListener`, and
 * we only need id resolution for `$getNodeById`, not live-editing id assignment.
 */
export function buildDiffState(
  before: SerializedEditorState,
  diffs: readonly Diff[]
): SerializedEditorState {
  const editor = createHeadlessEditor({
    namespace: 'diff-view',
    nodes: [...SupportedNodeTypes, DiffTextNode, ...NodeReplacements],
    onError: (error) => {
      throw error;
    },
  });

  const mappings: NodeIdMappings = {
    idToNodeKeyMap: new Map(),
    nodeKeyToIdMap: new Map(),
  };

  editor.setEditorState(editor.parseEditorState(before));
  editor.update(() => $updateAllNodeIds(mappings), { discrete: true });
  applyDiffs(editor, diffs, mappings);
  return editor.getEditorState().toJSON();
}
