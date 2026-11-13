import { type Accessor, createContext, useContext } from 'solid-js';
import type { KnownFolder } from '../utils/folder-path';

/**
 * Folders the surrounding view has already loaded, keyed by id. Drive holds
 * every folder for its sidebar, so its rows show a folder's path from that
 * list instead of asking the server once per row.
 */
const KnownFoldersContext =
  createContext<Accessor<ReadonlyMap<string, KnownFolder>>>();

export const KnownFoldersProvider = KnownFoldersContext.Provider;

/** The host's loaded folders, or undefined outside a host that provides them. */
export function useKnownFolders() {
  return useContext(KnownFoldersContext);
}
