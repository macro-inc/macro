import { match } from 'ts-pattern';
import type { DriveLocation } from './core/types';
import type { DriveDocumentRoute } from './primitives/drive-route';
import {
  driveFolderDocumentRoute,
  driveFolderRoute,
  driveRootDocumentRoute,
  driveSplitRoute,
  driveTabDocumentRoute,
  driveTabRoute,
} from './route';

/** Maps Drive domain selection to a route, including its folder/tab params. */
export function driveDestination(
  location: DriveLocation,
  document?: DriveDocumentRoute
) {
  const list = match(location)
    .with({ kind: 'folder' }, ({ id }) => ({
      route: driveFolderRoute,
      params: { view: 'folder' as const, folderId: id ?? undefined },
    }))
    .with({ kind: 'tab', tab: 'owned' }, () => ({
      route: driveSplitRoute,
      params: {},
    }))
    .otherwise(({ tab }) => ({ route: driveTabRoute, params: { tab } }));
  if (!document) return list;

  return {
    route: match(location)
      .with({ kind: 'folder' }, () => driveFolderDocumentRoute)
      .with({ kind: 'tab', tab: 'owned' }, () => driveRootDocumentRoute)
      .otherwise(() => driveTabDocumentRoute),
    params: {
      ...list.params,
      documentId: document.id,
      documentType: document.type,
    },
  };
}
