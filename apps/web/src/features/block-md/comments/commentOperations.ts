import {
  DELETE_COMMENT_COMMAND,
  DISCARD_DRAFT_COMMENT_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { createCallback } from '@solid-primitives/rootless';
import { useMarkdownDocument } from '../context/markdown-document-context';

export function useDeleteNewComments() {
  const { state } = useMarkdownDocument();
  const { comments: commentState, setCommentState } = state;

  return createCallback((discardPending = true) => {
    const editor = state.editor.md.editor;
    const nativeDraft = editor ? undefined : state.editor.md.commentDraft;
    for (const [markId, mark] of Object.entries(commentState.marks)) {
      if (!mark || !mark.existsOnServer) {
        setCommentState('marks', markId, undefined);
        editor?.dispatchCommand(DELETE_COMMENT_COMMAND, [markId, false]);
        // Source DELETE_COMMENT_COMMAND discards the local draft it names.
        if (nativeDraft?.current() === markId) nativeDraft.discard();
      }
    }
    if (discardPending) {
      editor?.dispatchCommand(DISCARD_DRAFT_COMMENT_COMMAND, undefined);
      nativeDraft?.discard();
    }
  });
}
