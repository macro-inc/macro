import { fileTree, fileTreeRows } from './file-tree';
import type { Chapter } from './model';
import type { ReviewEntry } from './source';

/** Continuous reading follows repository order or the agent's chapter order. */
export function readerFiles(
  files: ReviewEntry[],
  chapters: Chapter[],
  walkthrough: boolean
) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const paths = new Set<string>();
  if (walkthrough)
    for (const chapter of chapters)
      for (const path of chapter.paths) if (byPath.has(path)) paths.add(path);
  for (const row of fileTreeRows(fileTree(files), new Set()))
    if (row.kind === 'file') paths.add(row.node.path);
  return [...paths].map((path) => byPath.get(path)!);
}
