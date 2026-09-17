import { folderAncestors } from './folder-tree';
import { driveLocationLabel } from './location-label';
import type { DriveFolder, DriveLocation } from './types';

export const DRIVE_VIEW_BREADCRUMB = 'drive-view';

export type DriveLocationBreadcrumb = {
  type: 'drive-location';
  value: string;
  label: string;
  location: DriveLocation;
};

function folderBreadcrumbValue(id: string) {
  return `drive-folder:${id}`;
}

export function driveLocationBreadcrumbs(
  location: DriveLocation,
  folders: DriveFolder[]
): DriveLocationBreadcrumb[] {
  if (location.kind === 'tab') {
    return [
      {
        type: 'drive-location',
        value: DRIVE_VIEW_BREADCRUMB,
        label: driveLocationLabel(location, folders),
        location,
      },
    ];
  }

  return [
    {
      type: 'drive-location',
      value: DRIVE_VIEW_BREADCRUMB,
      label: 'Drive',
      location: { kind: 'folder', id: null },
    },
    ...(location.id
      ? folderAncestors(folders, location.id).map((folder) => ({
          type: 'drive-location' as const,
          value: folderBreadcrumbValue(folder.id),
          label: folder.name,
          location: { kind: 'folder' as const, id: folder.id },
        }))
      : []),
  ];
}
