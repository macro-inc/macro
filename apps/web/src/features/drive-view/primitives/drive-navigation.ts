import { type Accessor, batch, type Setter } from 'solid-js';
import type { DriveResults } from '../context/drive-source';
import { folderAncestors } from '../core/folder-tree';
import type {
  DriveFolder,
  DriveLocation,
  DriveScope,
  DriveState,
} from '../core/types';

export function createDriveNavigation(options: {
  state: Accessor<DriveState>;
  setState: Setter<DriveState>;
  folders: Accessor<DriveFolder[]>;
  results: DriveResults;
  onNavigate: () => void;
}) {
  const navigate = (location: DriveLocation) => {
    const ancestors =
      location.kind === 'folder' && location.id
        ? folderAncestors(options.folders(), location.id).map(
            (folder) => folder.id
          )
        : [];
    const current = options.state();
    const next: DriveState = {
      ...current,
      location,
      scope: 'default',
      rootOpen: true,
      expandedFolderIds: [
        ...new Set([...current.expandedFolderIds, ...ancestors]),
      ],
    };
    batch(() => {
      options.setState(next);
      options.results.apply(next, true);
      options.onNavigate();
    });
  };
  const setScope = (scope: DriveScope) =>
    batch(() => {
      const next = { ...options.state(), scope };
      options.setState(next);
      options.results.apply(next, false);
    });
  return { navigate, setScope };
}
