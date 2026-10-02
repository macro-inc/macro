import type { Chapter, ReviewFile } from './model';

export type TreeFile = Pick<
  ReviewFile,
  'path' | 'status' | 'added' | 'removed'
>;
export type FileNode =
  | ({ kind: 'file'; name: string } & TreeFile)
  | { kind: 'folder'; name: string; path: string; children: FileNode[] };

/** Compact single-folder chains so deep repository paths leave room for filenames. */
export function fileTree(files: TreeFile[]): FileNode[] {
  type Directory = { folders: Map<string, Directory>; files: TreeFile[] };
  const root: Directory = { folders: new Map(), files: [] };
  for (const file of files) {
    let directory = root;
    for (const name of file.path.split('/').slice(0, -1)) {
      let child = directory.folders.get(name);
      if (!child) {
        child = { folders: new Map(), files: [] };
        directory.folders.set(name, child);
      }
      directory = child;
    }
    directory.files.push(file);
  }
  const nodes = (directory: Directory, prefix: string): FileNode[] => [
    ...[...directory.folders]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([segment, value]): FileNode => {
        let name = segment;
        let child = value;
        while (!child.files.length && child.folders.size === 1) {
          const next = child.folders.entries().next().value;
          if (!next) break;
          name += `/${next[0]}`;
          child = next[1];
        }
        const path = prefix + name;
        return {
          kind: 'folder',
          name,
          path,
          children: nodes(child, `${path}/`),
        };
      }),
    ...directory.files
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(
        (file): FileNode => ({
          ...file,
          kind: 'file',
          name: file.path.split('/').at(-1) ?? file.path,
        })
      ),
  ];
  return nodes(root, '');
}

type WalkthroughTree = {
  key: string;
  chapter?: number;
  title: string;
  count: number;
  children: FileNode[];
};

export function walkthroughTrees(
  chapters: Chapter[],
  files: TreeFile[]
): WalkthroughTree[] {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const included = new Set<string>();
  const groups: WalkthroughTree[] = chapters.map((chapter, index) => {
    const members = [...new Set(chapter.paths)].flatMap((path) => {
      const file = byPath.get(path);
      if (!file) return [];
      included.add(path);
      return [file];
    });
    return {
      key: `chapter:${index}`,
      chapter: index,
      title: chapter.title,
      count: members.length,
      children: fileTree(members),
    };
  });
  const remaining = files.filter((file) => !included.has(file.path));
  if (remaining.length)
    groups.push({
      key: 'other',
      chapter: undefined,
      title: chapters.length ? 'Other changes' : 'Changes',
      count: remaining.length,
      children: fileTree(remaining),
    });
  return groups;
}

type FileTreeRow = {
  kind: 'folder' | 'file';
  key: string;
  node: FileNode;
  chapter?: number;
  depth: number;
};

export type NavigationRow =
  | {
      kind: 'chapter';
      key: string;
      title: string;
      chapter?: number;
      count: number;
    }
  | FileTreeRow;

/** Flatten only open folders, with keys scoped independently from tour chapters. */
export function fileTreeRows(
  tree: FileNode[],
  collapsed: ReadonlySet<string>,
  group = 'full',
  chapter?: number
): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  const visit = (nodes: FileNode[], depth: number) => {
    for (const node of nodes) {
      const key = `${group}:${node.path}`;
      rows.push({ kind: node.kind, key, node, chapter, depth });
      if (node.kind === 'folder' && !collapsed.has(key))
        visit(node.children, depth + 1);
    }
  };
  visit(tree, 0);
  return rows;
}

export function navigationRows(
  groups: ReturnType<typeof walkthroughTrees>,
  collapsed: ReadonlySet<string>
): NavigationRow[] {
  const rows: NavigationRow[] = [];
  for (const group of groups) {
    rows.push({ ...group, kind: 'chapter' });
    if (!collapsed.has(group.key))
      rows.push(
        ...fileTreeRows(group.children, collapsed, group.key, group.chapter)
      );
  }
  return rows;
}
