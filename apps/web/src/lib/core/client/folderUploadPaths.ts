import type { FileDetail } from './zipWorkerClient';

type PickedFile = Pick<File, 'name' | 'webkitRelativePath'>;

export interface PickedFolderGroup<F extends PickedFile> {
  files: F[];
  details: FileDetail[];
}

/**
 * Groups files from a folder picker by the folder the user picked.
 *
 * Zip paths keep that folder as their first segment, matching a dropped
 * folder. The server names the upload after the zip's single top folder, so
 * stripping it would rename the upload whenever the picked folder holds just
 * one subfolder.
 */
export function groupPickedFolderFiles<F extends PickedFile>(
  files: F[]
): Map<string, PickedFolderGroup<F>> {
  const groups = new Map<string, PickedFolderGroup<F>>();
  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name;
    const top = relativePath.split('/')[0] || file.name;
    const group = groups.get(top) ?? { files: [], details: [] };
    group.files.push(file);
    group.details.push({ path: relativePath });
    groups.set(top, group);
  }
  return groups;
}

/** Joins a parent zip path and an entry name. */
export function joinZipPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}
