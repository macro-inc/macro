import { useBlockId } from '@core/block';
import { Discussion, DiscussionProvider } from '@core/comments/discussion';
import { useUrlParams } from '@core/component/ParamsProvider';
import { hasPermissions, Permissions } from '@core/component/SharePermissions';
import { useUserId } from '@core/context/user';
import { buildSimpleEntityUrl } from '@core/util/url';
import { createMessageDiscussionSource } from '@queries/messages-discussion';
import { URL_PARAMS } from '../constants';
import { useEmailContext } from './EmailContext';

/** Comments inherit the email thread's explicit sharing permissions. */
export function InternalDiscussion() {
  const id = useBlockId();
  const email = useEmailContext();
  const params = useUrlParams(URL_PARAMS);
  const source = createMessageDiscussionSource({
    parent: () => ({ type: 'email_thread', id }),
    canEdit: () =>
      hasPermissions(email.permissions().type, Permissions.CAN_COMMENT),
    canManageThreads: () => email.permissions().type === Permissions.OWNER,
    currentUserId: useUserId(),
    targetCommentId: () => params.commentId() ?? null,
    buildCommentLink: (comment) =>
      buildSimpleEntityUrl(
        { type: 'email', id },
        { [URL_PARAMS.commentId]: comment.id }
      ),
  });
  return (
    <div class="w-full macro-message-width">
      <DiscussionProvider source={source}>
        <Discussion label="Internal comments" />
      </DiscussionProvider>
    </div>
  );
}
