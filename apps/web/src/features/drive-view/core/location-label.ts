import { DRIVE_TABS, type DriveFolder, type DriveLocation } from './types';

export function driveLocationLabel(
  location: DriveLocation,
  folders: readonly DriveFolder[] = []
): string {
  if (location.kind === 'folder') {
    return folders.find((folder) => folder.id === location.id)?.name ?? 'Drive';
  }
  return DRIVE_TABS.find((tab) => tab.id === location.tab)?.label ?? 'My Files';
}
