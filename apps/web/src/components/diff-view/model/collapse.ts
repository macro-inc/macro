import type { DiffFile } from './diff-file';

/** Files with at most this many additions + deletions open expanded. */
export const DEFAULT_EXPANDED_LINE_LIMIT = 40;

export function defaultCollapsedPaths(
  files: readonly Pick<DiffFile, 'path' | 'additions' | 'deletions'>[]
): string[] {
  return files
    .filter(
      (file) => file.additions + file.deletions > DEFAULT_EXPANDED_LINE_LIMIT
    )
    .map((file) => file.path);
}
