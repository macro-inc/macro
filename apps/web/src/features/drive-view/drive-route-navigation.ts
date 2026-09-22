import type { SplitRouteNavigationTarget } from '@app/split-router';
import {
  driveFolderDocumentRoute,
  driveFolderRoute,
  driveRootDocumentRoute,
  driveSplitRoute,
  driveTabDocumentRoute,
  driveTabRoute,
} from '@components/app/split-layout/split-router/app-routes';
import type { DriveLocation } from './core/types';
import type { DriveDocumentRoute } from './primitives/drive-route';

type DriveDestination = SplitRouteNavigationTarget<
  | typeof driveSplitRoute
  | typeof driveFolderRoute
  | typeof driveFolderDocumentRoute
  | typeof driveTabRoute
  | typeof driveTabDocumentRoute
  | typeof driveRootDocumentRoute
>;

/** Maps Drive domain selection to its ancestry-aware application route. */
export function driveDestination(
  location: DriveLocation,
  document?: DriveDocumentRoute
): DriveDestination {
  const detail = document && {
    documentId: document.id,
    documentType: document.type,
  };
  if (location.kind === 'folder') {
    const params = {
      view: 'folder' as const,
      folderId: location.id ?? undefined,
    };
    return detail
      ? {
          route: driveFolderDocumentRoute,
          params: { ...params, ...detail },
        }
      : { route: driveFolderRoute, params };
  }
  if (location.tab !== 'owned') {
    const params = { tab: location.tab };
    return detail
      ? { route: driveTabDocumentRoute, params: { ...params, ...detail } }
      : { route: driveTabRoute, params };
  }
  return detail
    ? { route: driveRootDocumentRoute, params: detail }
    : { route: driveSplitRoute, params: {} };
}
