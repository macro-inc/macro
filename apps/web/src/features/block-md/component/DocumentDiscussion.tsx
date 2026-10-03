import { useUrlParams } from '@core/component/ParamsProvider';
import { COMMENT_LINK_PARAM } from '@core/messages/comment-link';
import { EntityDiscussion } from '@core/messages/EntityDiscussion';
import {
  useMessageLink,
  useMessageRootsQuery,
} from '@queries/messages/document-messages';
import { useMarkdownDocument } from '../context/markdown-document-context';

/**
 * Unanchored document roots rendered with the shared message components. On
 * touch devices the composer moves to the floating accessory region and the
 * conversation shows only once it has roots, as the editor page does.
 */
export function DocumentDiscussion(props: {
  editorHasFocus: boolean;
  label?: string;
}) {
  const { documentId, kind, permissions } = useMarkdownDocument();
  const id = documentId();
  const documentKind = kind();
  const blockName = documentKind === 'document' ? 'md' : documentKind;
  const parent = () => ({ type: 'document' as const, id });
  const params = useUrlParams({ commentId: COMMENT_LINK_PARAM });
  const target = useMessageLink(parent, params.commentId);
  const roots = useMessageRootsQuery(parent);
  const discussionTarget = () =>
    roots.isSuccess &&
    roots.data.find((thread) => thread.id === target.rootId())?.state.anchor ===
      null
      ? target.messageId()
      : null;
  return (
    <EntityDiscussion
      parent={parent()}
      targetId={discussionTarget()}
      canWrite={permissions.canComment()}
      canModerate={permissions.isOwner()}
      link={{ type: blockName, id }}
      label={props.label}
      floatingComposerOnTouch
      editorHasFocus={props.editorHasFocus}
    />
  );
}
