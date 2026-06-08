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

const useIsEditable = (mustBeConnected: boolean = true) => {
  const source = blockSourceSignal.get;
  const syncSource = blockSyncSourceSignal.get;
  return createMemo(() => {
    const source_ = source();
    if (!source_) return false;
    if (isSourceSyncService(source_)) {
      const syncSource_ = syncSource();
      if (!syncSource_) return false;
      if (!mustBeConnected) return true;
      const status = syncSource_.status();
      return status === SyncSourceStatus.Connected;
    }

    return true;
  });
};

const usePermissionCan = (
  requestedPermissions: Permissions,
  mustBeConnected: boolean = true
) => {
  const isAuthenticated = useIsAuthenticated();
  const hasAccess = useHasAccess(requestedPermissions);
  const isEditable = useIsEditable(mustBeConnected);

  return createMemo(() => {
    if (!isAuthenticated()) return false;
    if (!hasAccess()) return false;
    return isEditable();
  });
};

export const useCanView = () => useHasAccess(Permissions.CAN_VIEW);
export const useCanComment = () => usePermissionCan(Permissions.CAN_COMMENT);
export const useCanEdit = (mustBeConnected: boolean = true) =>
  usePermissionCan(Permissions.CAN_EDIT, mustBeConnected);
export const useIsDocumentOwner = () => useHasAccess(Permissions.OWNER);

const _useReadOnly = () => {
  const canView = useCanView();
  const canComment = useCanComment();
  return createMemo(() => canView() && !canComment());
};
