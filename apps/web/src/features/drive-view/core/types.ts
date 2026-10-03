import type { FacetSelection } from '@app/features/soup/filters/facets/types';

export type DriveTab = 'owned' | 'recent' | 'shared';
export type DriveScope = 'default' | 'all' | 'attachments';
export type DriveSort = 'updated_at' | 'created_at' | 'viewed_at';

export type DriveLocation =
  | { kind: 'tab'; tab: DriveTab }
  | { kind: 'folder'; id: string | null };

export type DriveFolder = {
  id: string;
  name: string;
  parentId?: string | null;
};

export type DriveFolderNode = DriveFolder & { children: DriveFolderNode[] };

export type DriveState = {
  location: DriveLocation;
  scope: DriveScope;
  sort: DriveSort;
  search: string;
  facets: FacetSelection;
  expandedFolderIds: string[];
  favoritesOpen: boolean;
  rootOpen: boolean;
  tagsOpen: boolean;
};

export const DRIVE_TABS = [
  { id: 'owned', label: 'My Files' },
  { id: 'recent', label: 'Recent' },
  { id: 'shared', label: 'Shared with me' },
] satisfies { id: DriveTab; label: string }[];

export const DRIVE_SORT_OPTIONS = [
  { id: 'updated_at', label: 'Last modified' },
  { id: 'created_at', label: 'Created' },
  { id: 'viewed_at', label: 'Last viewed' },
] satisfies { id: DriveSort; label: string }[];

/** The touch header's pills: the tabs plus the folder overview. */
export type DriveMobileTab = DriveTab | 'folders';

/**
 * Pill order for the touch header; the first entry is the default location
 * on touch devices. DRIVE_TABS keeps the desktop sidebar order.
 */
export const DRIVE_MOBILE_TABS = [
  { id: 'recent', label: 'Recent' },
  { id: 'owned', label: 'My Files' },
  { id: 'shared', label: 'Shared with me' },
  { id: 'folders', label: 'Folders' },
] satisfies { id: DriveMobileTab; label: string }[];

export function driveMobileTabLocation(tab: DriveMobileTab): DriveLocation {
  return tab === 'folders'
    ? { kind: 'folder', id: null }
    : { kind: 'tab', tab };
}
