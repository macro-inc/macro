/**
 * A tree of items by path: directories compressed along single-child chains
 * (`apps/web/src` reads as one row when nothing branches off it), items in
 * input order under their directory, directories before items.
 */

export type FileTreeDirectory<T> = {
  kind: 'directory';
  /** The compressed segment, e.g. `apps/web/src`. */
  name: string;
  /** Full path of the directory, for a stable key. */
  path: string;
  children: FileTreeNode<T>[];
};

export type FileTreeFile<T> = {
  kind: 'file';
  /** Basename shown in the row. */
  name: string;
  /** Full path; the file's identity in the tree. */
  path: string;
  item: T;
};

export type FileTreeNode<T> = FileTreeDirectory<T> | FileTreeFile<T>;

type MutableDirectory<T> = {
  name: string;
  path: string;
  directories: Map<string, MutableDirectory<T>>;
  files: FileTreeFile<T>[];
};

function newDirectory<T>(name: string, path: string): MutableDirectory<T> {
  return { name, path, directories: new Map(), files: [] };
}

/**
 * Build the tree from each item's path. Order is preserved: directories
 * appear in the order their first item appeared, items in input order.
 */
export function buildFileTree<T>(
  items: readonly T[],
  pathOf: (item: T) => string
): FileTreeNode<T>[] {
  const root = newDirectory<T>('', '');
  for (const item of items) {
    const path = pathOf(item);
    const segments = path.split('/').filter((segment) => segment !== '');
    const name = segments.pop() ?? path;
    let node = root;
    for (const segment of segments) {
      let next = node.directories.get(segment);
      if (!next) {
        next = newDirectory(
          segment,
          node.path ? `${node.path}/${segment}` : segment
        );
        node.directories.set(segment, next);
      }
      node = next;
    }
    node.files.push({ kind: 'file', name, path, item });
  }
  return [...compress(root).map(finish), ...root.files];
}

/** Fold a directory with exactly one child directory and no files into it. */
function compress<T>(directory: MutableDirectory<T>): MutableDirectory<T>[] {
  const out: MutableDirectory<T>[] = [];
  for (let child of directory.directories.values()) {
    while (child.files.length === 0 && child.directories.size === 1) {
      const [only] = child.directories.values();
      child = {
        name: `${child.name}/${only!.name}`,
        path: only!.path,
        directories: only!.directories,
        files: only!.files,
      };
    }
    out.push(child);
  }
  return out;
}

function finish<T>(directory: MutableDirectory<T>): FileTreeDirectory<T> {
  return {
    kind: 'directory',
    name: directory.name,
    path: directory.path,
    children: [...compress(directory).map(finish), ...directory.files],
  };
}

/** A node as it appears on screen: its depth, and the directory above it. */
export type VisibleNode<T> = {
  node: FileTreeNode<T>;
  level: number;
  parent: string | undefined;
};

/** The rows on screen, in display order, skipping closed directories. */
export function visibleNodes<T>(
  nodes: readonly FileTreeNode<T>[],
  isOpen: (path: string) => boolean
): VisibleNode<T>[] {
  const out: VisibleNode<T>[] = [];
  const walk = (
    list: readonly FileTreeNode<T>[],
    level: number,
    parent: string | undefined
  ) => {
    for (const node of list) {
      out.push({ node, level, parent });
      if (node.kind === 'directory' && isOpen(node.path)) {
        walk(node.children, level + 1, node.path);
      }
    }
  };
  walk(nodes, 1, undefined);
  return out;
}
