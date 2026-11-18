import { Access } from '@macro-inc/collaboration/session/abi.generated';
import type { SessionAuthorization } from '@macro-inc/collaboration/session/executor';
import { authKeys } from '@queries/auth/keys';
import type { UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import type { SyncDocumentOpenContext } from '@queries/storage/documentLoad/sync-document-context-loader';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';

const access: Record<AccessLevel, Access> = {
  view: Access.Read,
  comment: Access.CommentOnly,
  edit: Access.Edit,
  owner: Access.Edit,
};

/** Translate the query layer's account-fenced authority into native inputs. */
export function createEditorAuthorization(
  documentId: string,
  context: SyncDocumentOpenContext
): {
  user: string;
  access: Access;
  auth: SessionAuthorization;
} {
  const identity = queryClient.getQueryData<UserInfoData>(
    authKeys.userInfo.queryKey
  );
  const authorization = context.authorization;
  if (!identity?.authenticated || !identity.id || !authorization?.isCurrent())
    throw new Error('Editor authorization is unavailable');
  return {
    user: identity.id,
    access: access[context.userAccessLevel],
    auth: {
      async token(doc) {
        if (doc !== documentId || !authorization.isCurrent())
          throw new Error('Editor authorization changed');
        const token = await authorization.getToken();
        const current = authorization.currentAccess();
        if (!authorization.isCurrent() || current === undefined)
          throw new Error('Editor authorization changed');
        return { token, access: access[current] };
      },
      subscribe(callback) {
        return authorization.onInvalidated(() =>
          callback(authorization.isCurrent(), false, false)
        );
      },
    },
  };
}
