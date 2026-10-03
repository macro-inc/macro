import {
  DELETE_COMMENT_COMMAND,
  DISCARD_DRAFT_COMMENT_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { createCallback } from '@solid-primitives/rootless';
import { useMarkdownDocument } from '../context/markdown-document-context';

export function useDeleteNewComments() {
  const { state } = useMarkdownDocument();
  const { comments: commentState, setCommentState } = state;
  const editor = state.editor.md.editor;

  return createCallback((discardPending = true) => {
    // console.trace('delete new comments');
    for (const [markId, mark] of Object.entries(commentState.marks)) {
      if (!mark || !mark.existsOnServer) {
        setCommentState('marks', markId, undefined);
        editor?.dispatchCommand(DELETE_COMMENT_COMMAND, [markId, false]);
      }
      if (discardPending) {
        editor?.dispatchCommand(DISCARD_DRAFT_COMMENT_COMMAND, undefined);
      }
    }
  });
}
