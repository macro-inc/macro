import { useBlockAliasedName, useBlockId } from '@core/block';
import { useUrlParams } from '@core/component/ParamsProvider';
import { useUserId } from '@core/context/user';
import { useCanComment, useIsDocumentOwner } from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import { createMessageDiscussionSource } from '@queries/messages-discussion';
import { URL_PARAMS } from '../constants';

/** Whole-document discussions share messages and cache with anchored threads. */
export function createDocumentDiscussionSource() {
  const documentId = useBlockId();
  const blockName = useBlockAliasedName();
  const params = useUrlParams(URL_PARAMS);
  return createMessageDiscussionSource({
    parent: () => ({ type: 'document', id: documentId }),
    includeAnchored: true,
    canEdit: useCanComment(),
    canManageThreads: useIsDocumentOwner(),
    currentUserId: useUserId(),
    targetCommentId: () => params.commentId() ?? null,
    buildCommentLink: (comment) =>
      buildSimpleEntityUrl(
        { type: blockName, id: documentId },
        { [URL_PARAMS.commentId]: comment.id }
      ),
  });
}
