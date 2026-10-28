/**
 * A changed file as the diff view shows it, and the small derivations its
 * rows need. A host's own file records only need to match this shape.
 */

/** What happened to a file between the base and the head. */
export type DiffFileKind = 'added' | 'modified' | 'deleted' | 'renamed';

export type DiffFile = {
  /** The path after the change, or before it for a deletion. */
  path: string;
  /** Where a renamed file came from. */
  previousPath?: string;
  kind: DiffFileKind;
  additions: number;
  deletions: number;
  /** The diff carries no text for this file. */
  binary: boolean;
  /** The file's hunks were left out of the patch to fit a size budget. */
  patchOmitted: boolean;
};

export type DiffStyle = 'unified' | 'split';

/** The one-letter status the tree and file headers show. */
export type StatusLetter = 'A' | 'M' | 'D' | 'R';

export function statusLetter(kind: DiffFileKind): StatusLetter {
  switch (kind) {
    case 'added':
      return 'A';
    case 'modified':
      return 'M';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
  }
}

/** A path split into the directory prefix (with trailing slash) and basename. */
export function splitPath(path: string): { dir: string; base: string } {
  const at = path.lastIndexOf('/');
  if (at < 0) return { dir: '', base: path };
  return { dir: path.slice(0, at + 1), base: path.slice(at + 1) };
}
