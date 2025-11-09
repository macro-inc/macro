import { useIsAuthenticated } from '@core/auth';
import { SyncSourceStatus } from '@core/collab/source';
import {
  getPermissions,
  hasPermissions,
  Permissions,
} from '@core/component/SharePermissions';
import { isSourceSyncService } from '@core/util/source';
import { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import { createMemo } from 'solid-js';
import {
  blockFileSignal,
  blockSourceSignal,
  blockSyncSourceSignal,
  blockUserAccessSignal,
} from './load';

export const useGetPermissions = () => {
  const isAuthenticated = useIsAuthenticated();
  // NOTE: if the dss file is available, we can assume the user can view
  const fileExists = createMemo(() => !!blockFileSignal());

  const accessLevel = createMemo(() => {
    if (!isAuthenticated()) return undefined;
    const accessLevel_ = blockUserAccessSignal();
    if (!accessLevel_ && fileExists()) return AccessLevel.view;
    return accessLevel_;
  });

  return createMemo(() => getPermissions(accessLevel()));
};

export const useHasAccess = (requestedPermissions: Permissions) => {
  const userPermissions = useGetPermissions();
  return createMemo(() =>
    hasPermissions(userPermissions(), requestedPermissions)
  );
};

export const useIsEditable = () => {
  const source = blockSourceSignal.get;
  const syncSource = blockSyncSourceSignal.get;
  return createMemo(() => {
    const source_ = source();
    if (!source_) return false;
    if (isSourceSyncService(source_)) {
      const syncSource_ = syncSource();
      if (!syncSource_) return false;
      const status = syncSource_.status();
      return status === SyncSourceStatus.Connected;
    }

    return true;
  });
};

export const usePermissionCan = (requestedPermissions: Permissions) => {
  const hasAccess = useHasAccess(requestedPermissions);
  const isEditable = useIsEditable();

  return createMemo(() => {
    if (!hasAccess()) return false;
    return isEditable();
  });
};

export const useCanView = () => useHasAccess(Permissions.CAN_VIEW);
export const useCanComment = () => usePermissionCan(Permissions.CAN_COMMENT);
export const useCanEdit = () => usePermissionCan(Permissions.CAN_EDIT);
export const useIsDocumentOwner = () => useHasAccess(Permissions.OWNER);

export const useReadOnly = () => {
  const canView = useCanView();
  const canComment = useCanComment();
  return createMemo(() => canView() && !canComment());
};
