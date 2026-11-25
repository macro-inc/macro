import { usePreference } from '@app/preferences/use-preference';
import { type Accessor, createMemo } from 'solid-js';
import {
  type DriveRootBrowseMode,
  type DriveSortDirection,
  type DriveViewMode,
  parseDriveRootBrowseMode,
  parseDriveViewMode,
} from '../core/drive-view-mode';

const PREF_VIEW_MODE = 'macro:pref:drive:view-mode';
const PREF_ROOT_MODE = 'macro:pref:drive:root-mode';
const PREF_FOLDERS_FIRST = 'macro:pref:drive:folders-first';
const PREF_INSPECTOR_OPEN = 'macro:pref:drive:inspector-open';
const PREF_SORT_DIRECTION = 'macro:pref:drive:sort-direction';

export type DriveViewPreferences = {
  viewMode: Accessor<DriveViewMode>;
  setViewMode: (mode: DriveViewMode) => void;
  rootMode: Accessor<DriveRootBrowseMode>;
  setRootMode: (mode: DriveRootBrowseMode) => void;
  foldersFirst: Accessor<boolean>;
  setFoldersFirst: (value: boolean) => void;
  toggleFoldersFirst: () => void;
  inspectorOpen: Accessor<boolean>;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  sortDirection: Accessor<DriveSortDirection>;
  setSortDirection: (direction: DriveSortDirection) => void;
  toggleSortDirection: () => void;
};

export function createDriveViewPreferences(): DriveViewPreferences {
  const [rawViewMode, setRawViewMode] = usePreference<DriveViewMode>(
    PREF_VIEW_MODE,
    { default: 'list' }
  );
  const [rawRootMode, setRawRootMode] = usePreference<DriveRootBrowseMode>(
    PREF_ROOT_MODE,
    { default: 'browse' }
  );
  const [foldersFirst, setFoldersFirst] = usePreference<boolean>(
    PREF_FOLDERS_FIRST,
    { default: true }
  );
  const [inspectorOpen, setInspectorOpen] = usePreference<boolean>(
    PREF_INSPECTOR_OPEN,
    { default: false }
  );
  const [sortDirection, setSortDirection] = usePreference<DriveSortDirection>(
    PREF_SORT_DIRECTION,
    { default: 'desc' }
  );

  const viewMode = createMemo(() => parseDriveViewMode(rawViewMode()));
  const rootMode = createMemo(() => parseDriveRootBrowseMode(rawRootMode()));

  return {
    viewMode,
    setViewMode: (mode) => setRawViewMode(mode),
    rootMode,
    setRootMode: (mode) => setRawRootMode(mode),
    foldersFirst,
    setFoldersFirst,
    toggleFoldersFirst: () => setFoldersFirst((current) => !current),
    inspectorOpen,
    setInspectorOpen,
    toggleInspector: () => setInspectorOpen((current) => !current),
    sortDirection,
    setSortDirection,
    toggleSortDirection: () =>
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc')),
  };
}
