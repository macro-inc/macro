import type { Project } from '@service-storage/generated/schemas/project';
export type FolderNode = { folder: Project; children: FolderNode[] };

/** Keep orphaned folders visible and break malformed cycles without losing nodes. */
export function buildFolderTree(projects: Project[]): FolderNode[] {
  const folders = new Map(
    projects
      .filter((p) => !p.deletedAt)
      .map((folder) => [folder.id, { folder, children: [] as FolderNode[] }])
  );
  const roots: FolderNode[] = [];
  for (const node of folders.values()) {
    let ancestor = node.folder.parentId;
    const seen = new Set([node.folder.id]);
    let cyclic = false;
    while (ancestor && folders.has(ancestor)) {
      if (seen.has(ancestor)) {
        cyclic = true;
        break;
      }
      seen.add(ancestor);
      ancestor = folders.get(ancestor)!.folder.parentId;
    }
    const parent = node.folder.parentId && folders.get(node.folder.parentId);
    if (parent && !cyclic) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.folder.name.localeCompare(b.folder.name));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}
