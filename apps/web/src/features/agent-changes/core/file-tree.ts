/**
 * The changed-files tree: directories compressed along single-child chains
 * (`apps/web/src` reads as one row when nothing branches off it), files in
 * patch order under their directory, directories before files.
 */

import type { ChangedFile } from './changeset';

export type FileTreeDir = {
  kind: 'dir';
  /** The compressed segment, e.g. `apps/web/src`. */
  name: string;
  /** Full path of the directory, for a stable key. */
  path: string;
  children: FileTreeNode[];
};

export type FileTreeFile = {
  kind: 'file';
  /** Basename shown in the row. */
  name: string;
  file: ChangedFile;
};

export type FileTreeNode = FileTreeDir | FileTreeFile;

type MutableDir = {
  name: string;
  path: string;
  dirs: Map<string, MutableDir>;
  files: FileTreeFile[];
};

function newDir(name: string, path: string): MutableDir {
  return { name, path, dirs: new Map(), files: [] };
}

/**
 * Build the tree from the files' paths. Order is preserved: directories
 * appear in the order their first file appeared, files in patch order.
 */
export function buildFileTree(files: readonly ChangedFile[]): FileTreeNode[] {
  const root = newDir('', '');
  for (const file of files) {
    const segments = file.path.split('/').filter((segment) => segment !== '');
    const base = segments.pop() ?? file.path;
    let node = root;
    for (const segment of segments) {
      let next = node.dirs.get(segment);
      if (!next) {
        next = newDir(segment, node.path ? `${node.path}/${segment}` : segment);
        node.dirs.set(segment, next);
      }
      node = next;
    }
    node.files.push({ kind: 'file', name: base, file });
  }
  return [...compress(root).map(finish), ...root.files];
}

/** Fold a directory with exactly one child directory and no files into it. */
function compress(dir: MutableDir): MutableDir[] {
  const out: MutableDir[] = [];
  for (let child of dir.dirs.values()) {
    while (child.files.length === 0 && child.dirs.size === 1) {
      const [only] = child.dirs.values();
      child = {
        name: `${child.name}/${only!.name}`,
        path: only!.path,
        dirs: only!.dirs,
        files: only!.files,
      };
    }
    out.push(child);
  }
  return out;
}

function finish(dir: MutableDir): FileTreeDir {
  return {
    kind: 'dir',
    name: dir.name,
    path: dir.path,
    children: [...compress(dir).map(finish), ...dir.files],
  };
}

/** Every file in the tree, depth first, in display order. */
export function flattenFiles(nodes: readonly FileTreeNode[]): ChangedFile[] {
  const out: ChangedFile[] = [];
  const walk = (list: readonly FileTreeNode[]) => {
    for (const node of list) {
      if (node.kind === 'file') out.push(node.file);
      else walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
