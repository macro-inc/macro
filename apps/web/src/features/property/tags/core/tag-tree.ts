/** The tree keeps stored tag names and identifiers intact. */
export type TreeTag = {
  id: string;
  label: string;
  color?: string;
  scope: 'user' | 'team';
  propertyDefinitionId: string;
};

export type TagTreeNode = {
  id: string;
  name: string;
  path: string;
  tag?: TreeTag;
  children: TagTreeNode[];
};

/** One child level; remaining path segments stay in the child's label.
 * Input order determines sibling order; scopes never share branches.
 */
export function buildTagTree(tags: readonly TreeTag[]): TagTreeNode[] {
  const roots: TagTreeNode[] = [];
  const byPath = new Map<string, TagTreeNode>();
  for (const tag of tags) {
    const parts = tag.label.split('/');
    // Preserve unusual names verbatim rather than merging distinct tags or
    // rendering unnamed branches for leading, trailing, or repeated slashes.
    const segments =
      parts.length > 1 && parts.every((part) => part.trim().length > 0)
        ? [parts[0], parts.slice(1).join('/')]
        : [tag.label];
    let siblings = roots;
    for (let index = 0; index < segments.length; index++) {
      const path = segments.slice(0, index + 1).join('/');
      const id = JSON.stringify([tag.scope, tag.propertyDefinitionId, path]);
      let node = byPath.get(id);
      if (!node) {
        node = { id, name: segments[index], path, children: [] };
        byPath.set(id, node);
        siblings.push(node);
      }
      if (index === segments.length - 1) node.tag = tag;
      siblings = node.children;
    }
  }
  return roots;
}
