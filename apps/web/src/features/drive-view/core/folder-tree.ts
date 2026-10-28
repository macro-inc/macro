import type { DriveFolder, DriveFolderNode } from './types';

/** Missing parents become roots; inaccessible ancestors must not hide folders. */
export function buildFolderTree(
  folders: readonly DriveFolder[]
): DriveFolderNode[] {
  const nodes = new Map(
    folders.map((folder) => [
      folder.id,
      { ...folder, children: [] as DriveFolderNode[] },
    ])
  );
  const roots: DriveFolderNode[] = [];
  for (const node of nodes.values()) {
    const ancestors = new Set([node.id]);
    let parentId = node.parentId;
    let cycle = false;
    while (parentId && nodes.has(parentId)) {
      if (ancestors.has(parentId)) {
        cycle = true;
        break;
      }
      ancestors.add(parentId);
      parentId = nodes.get(parentId)?.parentId;
    }
    const parent =
      node.parentId && !cycle ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (items: DriveFolderNode[]) => {
    items.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );
    items.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

/** Keep ancestors of matching descendants, including when their branch is closed. */
export function filterFolderTree(
  nodes: readonly DriveFolderNode[],
  search: string
): DriveFolderNode[] {
  const term = search.trim().toLocaleLowerCase();
  if (!term) return [...nodes];
  return nodes.flatMap((node) => {
    if (node.name.toLocaleLowerCase().includes(term)) return [node];
    const children = filterFolderTree(node.children, term);
    return children.length ? [{ ...node, children }] : [];
  });
}

export function folderAncestors(
  folders: readonly DriveFolder[],
  id: string
): DriveFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const result: DriveFolder[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    result.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}
