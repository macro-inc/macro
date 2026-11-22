import type {
  NativeCommentMarkChange,
  NativeComments,
} from '@core/component/LexicalMarkdown/editing/overlay-hosts/native-comments';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { hasPostedComment } from '@queries/messages/posted-comment';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import {
  type CommentMarkFeed,
  createMessageCommentThreads,
} from './messageCommentThreads';
import { createNativeCommentDraft } from './NativeCommentDraft';

/** Native engine adapter for the shared message comment threads. */
export function NativeMessageCommentsProvider(props: {
  activeComment?: Accessor<string | undefined>;
  comments: NativeComments;
  ready: Accessor<boolean>;
}) {
  const { comments } = props;
  const { documentId, state } = useMarkdownDocument();
  const userId = useUserId();
  const selectionListeners = new Set<() => void>();
  let feed: CommentMarkFeed | undefined;

  const removeMark = async (markId: string) => {
    if (!(await comments.remove(markId)))
      Telemetry.warn('comment.mark.remove_refused', {
        'comment.mark_id': markId,
      });
  };
  // Source commentPlugin.markSelected: report ids, then toggle classes.
  const markSelected = (ids: readonly string[]) => {
    feed?.setActiveIds([...ids]);
    comments.select(ids);
  };
  let draftId: () => string | undefined = () => undefined;
  // Source $selectMarksAtCaret; a null selection leaves the current state.
  const selectMarksAtCaret = () => {
    const localDraft = draftId();
    if (localDraft) {
      markSelected([localDraft]);
      return;
    }
    const ids = comments.caretMarkIds();
    if (ids === null) return;
    markSelected(ids);
  };

  feed = createMessageCommentThreads({
    activeComment: props.activeComment,
    host: {
      markIds: (key) => comments.markIds(Number(key)),
      removeMark: (markId) =>
        fireAndForget(removeMark(markId), 'native-comment-mark-removal'),
      selectMarks: (ids) => markSelected(ids),
      onSelectionChange: (listener) => {
        selectionListeners.add(listener);
        return () => selectionListeners.delete(listener);
      },
      ready: props.ready,
    },
  });
  const threads = feed;
  const draft = createNativeCommentDraft({
    view: comments.view,
    comments,
    userId,
    select: markSelected,
    hasPostedComment: (markId) => hasPostedComment(documentId(), markId),
    add: threads.addDraft,
    remove: threads.removeDraft,
  });
  draftId = draft.controls.current;
  state.editor.setMd('commentDraft', draft.controls);
  onCleanup(() => {
    if (state.editor.md.commentDraft === draft.controls)
      state.editor.setMd('commentDraft', undefined);
  });

  // Source CommentNode mutation listener: report removed ids, then each id.
  const apply = (
    changes: readonly NativeCommentMarkChange[],
    remaining: ReadonlySet<string>
  ) => {
    for (const change of changes) {
      const key = String(change.key);
      for (const id of change.before ?? [])
        if (!change.after?.includes(id))
          threads.remove(id, key, !remaining.has(id));
      if (!change.after || !change.element) continue;
      for (const id of change.after)
        threads.add(
          id,
          key,
          change.after,
          change.element,
          !change.isDraft,
          change.isDraft,
          false
        );
    }
  };
  const initial = comments.snapshot();
  apply(initial, new Set(initial.flatMap((change) => change.after ?? [])));
  // Source initializes once the editor state has content; native, once ready.
  createEffect(() => {
    if (props.ready()) threads.init();
  });
  selectMarksAtCaret();

  onCleanup(
    comments.subscribe((commit) => {
      apply(commit.changes, commit.remainingIds);
      selectMarksAtCaret();
      if (commit.selectionChanged)
        for (const listener of [...selectionListeners]) listener();
    })
  );
  // Source CLICK_COMMAND: a click reselects marks even without a caret move.
  comments.root.addEventListener('click', selectMarksAtCaret);
  onCleanup(() =>
    comments.root.removeEventListener('click', selectMarksAtCaret)
  );
  return <draft.Highlight />;
}
