/**
 * A unified patch, parsed once into Pierre's per-file diffs and matched back
 * to the host's files by path.
 */

import { type FileDiffMetadata, parsePatchFiles } from '@pierre/diffs';
import type { DiffFile } from './diff-file';

/** One file's parsed diff, or why there is none to draw. */
export type DiffEntry = {
  file: DiffFile;
  /** Absent when the patch has no text for the file. */
  diff?: FileDiffMetadata;
  /** Why the diff is absent, in a phrase the card can show. */
  note?: string;
};

/** Parse a unified patch into Pierre file diffs, keyed by their new path. */
export function parsePatch(patch: string): Map<string, FileDiffMetadata> {
  const byPath = new Map<string, FileDiffMetadata>();
  if (patch.trim() === '') return byPath;
  for (const parsed of parsePatchFiles(patch)) {
    for (const file of parsed.files) {
      byPath.set(file.name, file);
      if (file.type === 'deleted' && file.prevName)
        byPath.set(file.prevName, file);
    }
  }
  return byPath;
}

/** Pair each file with its parsed diff, in the files' order. */
export function matchFilesToDiffs(
  files: readonly DiffFile[],
  diffs: ReadonlyMap<string, FileDiffMetadata>
): DiffEntry[] {
  return files.map((file) => {
    if (file.binary) return { file, note: 'Binary file' };
    if (file.patchOmitted) {
      return { file, note: 'Diff left out to fit the size budget' };
    }
    const diff =
      diffs.get(file.path) ??
      (file.previousPath ? diffs.get(file.previousPath) : undefined);
    if (!diff) {
      return {
        file,
        note:
          file.kind === 'renamed' && file.additions + file.deletions === 0
            ? 'Renamed without changes'
            : 'No diff text for this file',
      };
    }
    return { file, diff };
  });
}
