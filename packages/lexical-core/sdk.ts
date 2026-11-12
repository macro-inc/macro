/**
 * The public entry for programs that edit Macro documents with Lexical
 * (`@macro-inc/sdk/lexical`): our nodes and their helpers, the `@lexical/*`
 * nodes documents use, node ids and markdown conversion. It leaves out the
 * package index's AI, diff and app-only utilities, so it bundles small and
 * runs headless.
 */

import { createHeadlessEditor } from '@lexical/headless';
import type { LexicalEditor } from 'lexical';
import { NodeReplacements, SupportedNodeTypes } from './node-list';

export * from '@lexical/code';
export * from '@lexical/link';
export * from '@lexical/list';
export * from '@lexical/mark';
export {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from '@lexical/markdown';
export * from '@lexical/rich-text';
export * from '@lexical/table';
export { NodeReplacements, SupportedNodeTypes } from './node-list';
export * from './nodes/AgentActivityNode';
export * from './nodes/AgentContextNode';
export * from './nodes/AgentSessionMentionNode';
export * from './nodes/AwaitNode';
export * from './nodes/BookingLinkMentionNode';
export * from './nodes/ClassedBlockNode';
export * from './nodes/CommentNode';
export * from './nodes/CompletionNode';
export * from './nodes/ConnectAppNode';
export * from './nodes/ContactMentionNode';
export * from './nodes/CursorSystemNotificationNode';
export * from './nodes/CustomCodeNode';
export * from './nodes/DatabaseQueryNode';
export * from './nodes/DateMentionNode';
export * from './nodes/DecoratorBlockNode';
export * from './nodes/DiffDeleteNode';
export * from './nodes/DiffInsertNode';
export * from './nodes/DiffNode';
export * from './nodes/DiffTextNode';
export * from './nodes/DocumentCardNode';
export * from './nodes/DocumentMentionNode';
export * from './nodes/EquationNode';
export * from './nodes/GroupMentionNode';
export * from './nodes/HorizontalRuleNode';
export * from './nodes/HtmlRenderNode';
export * from './nodes/ImageNode';
export * from './nodes/InlineSearchNode';
export * from './nodes/MagicChipNode';
export * from './nodes/MediaNode';
export * from './nodes/PasteNode';
export * from './nodes/PullRequestMentionNode';
export * from './nodes/ReplyTargetNode';
export * from './nodes/SearchMatchNode';
export * from './nodes/SnapshotNode';
export * from './nodes/TagMentionNode';
export * from './nodes/TaskListNode';
export * from './nodes/ThemeMentionNode';
export * from './nodes/UnknownMentionNode';
export * from './nodes/UnlinkedTextNode';
export * from './nodes/UserMentionNode';
export * from './nodes/VideoNode';
export * from './nodes/WatermarkNode';
export {
  $getId,
  $setId,
  $updateAllNodeIds,
  idState,
  type NodeIdMappings,
} from './plugins/nodeIdPlugin';
export {
  ALL_TRANSFORMERS,
  EXTERNAL_TRANSFORMERS,
  INTERNAL_TRANSFORMERS,
} from './transformers';

/**
 * A headless editor with every node a Macro document can hold registered.
 * Errors thrown inside `update`, `read` and `parseEditorState` propagate to
 * the caller; a failed `update` leaves the editor state as it was.
 */
export function createDocumentEditor(): LexicalEditor {
  // Lexical rolls a failed update back only after `onError` returns, so
  // `onError` records the error and the wrappers rethrow it once Lexical is done.
  let failure: Error | undefined;
  const editor = createHeadlessEditor({
    namespace: 'macro-document',
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError: (error) => {
      failure ??= error;
    },
  });
  const rethrow = () => {
    const error = failure;
    failure = undefined;
    if (error) throw error;
  };
  const update = editor.update.bind(editor);
  editor.update = (updateFn, options) => {
    update(updateFn, options);
    rethrow();
  };
  const parseEditorState = editor.parseEditorState.bind(editor);
  editor.parseEditorState = (state, updateFn) => {
    const parsed = parseEditorState(state, updateFn);
    rethrow();
    return parsed;
  };
  return editor;
}
