import { useIsAuthenticated } from '@core/auth';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { createMemo } from 'solid-js';
import {
  blockFileSignal,
  blockSourceSignal,
  blockUserAccessSignal,
} from './load';

export const useGetPermissions = () => {
  // NOTE: if the dss file is available, we can assume the user can view
  const fileExists = createMemo(() => !!blockFileSignal());

  const accessLevel = createMemo(() => {
    const accessLevel_ = blockUserAccessSignal();
    if (!accessLevel_ && fileExists()) return AccessLevel.view;
    return accessLevel_;
  });

  return createMemo(() => getPermissions(accessLevel()));
};

const useHasAccess = (requestedPermissions: Permissions) => {
  const userPermissions = useGetPermissions();
  return createMemo(() =>
    hasPermissions(userPermissions(), requestedPermissions)
  );
};

const useIsEditable = (_mustBeConnected: boolean = true) => {
  const source = blockSourceSignal.get;
  return createMemo(() => source() != null);
};

const usePermissionCan = (requestedPermissions: Permissions) => {
  const isAuthenticated = useIsAuthenticated();
  const hasAccess = useHasAccess(requestedPermissions);
  const isEditable = useIsEditable();

  return createMemo(() => {
    if (!isAuthenticated()) return false;
    if (!hasAccess()) return false;
    return isEditable();
  });
};

export const useCanView = () => useHasAccess(Permissions.CAN_VIEW);
export const useCanComment = () => usePermissionCan(Permissions.CAN_COMMENT);
export const useCanEdit = () => usePermissionCan(Permissions.CAN_EDIT);
export const useIsDocumentOwner = () => useHasAccess(Permissions.OWNER);

const _useReadOnly = () => {
  const canView = useCanView();
  const canComment = useCanComment();
  return createMemo(() => canView() && !canComment());
};
