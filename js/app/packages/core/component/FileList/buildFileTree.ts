import type { Item } from '@service-storage/generated/schemas/item';

export function buildFileTree(items: Item[]) {
  const itemMap: { [key: string]: { item: Item; children: Item[] } } = {};
  const rootItems: { item: Item; children: Item[] }[] = [];

  // First pass: Create a map of all items
  items.forEach((item) => {
    itemMap[item.id] = { item, children: [] };
  });

  // Second pass: Connect children to parents and identify root items
  items.forEach((item) => {
    const parentId = item.type === 'project' ? item.parentId : item.projectId;
    if (parentId && itemMap[parentId]) {
      itemMap[parentId].children.push(item);
    } else {
      rootItems.push(itemMap[item.id]);
    }
  });

  return { rootItems, itemMap };
}

/**
 * Builds a file tree that includes filtered items and their ancestors.
 * @param filteredItems - The filtered set of items.
 * @param allItems - The set of all items.
 * @returns The file tree.
 */
export function buildFileTreeWithAncestors(
  filteredItems: Item[],
  allItems: Item[]
) {
  const ancestorProjects = new Set<Item>();
  const itemsById = new Map(allItems.map((item) => [item.id, item]));
  const relevantItemMap: { [key: string]: { item: Item; children: Item[] } } =
    {};
  const rootItems: { item: Item; children: Item[] }[] = [];

  // add filtered items to map and identify all ancestor projects
  filteredItems.forEach((item) => {
    relevantItemMap[item.id] = { item, children: [] };
    let currentParentId =
      item.type === 'project' ? item.parentId : item.projectId;

    while (currentParentId) {
      const parentProject = itemsById.get(currentParentId);
      if (!parentProject) break;
      ancestorProjects.add(parentProject);
      currentParentId =
        parentProject?.type === 'project'
          ? parentProject.parentId
          : parentProject?.projectId || '';
    }
  });

  // add ancestor projects to map
  ancestorProjects.forEach((item) => {
    relevantItemMap[item.id] = { item, children: [] };
  });

  // add children to parents
  Object.keys(relevantItemMap).forEach((itemId) => {
    const item = relevantItemMap[itemId].item;
    const parentId = item.type === 'project' ? item.parentId : item.projectId;
    if (parentId && relevantItemMap[parentId]) {
      relevantItemMap[parentId].children.push(item);
    } else {
      rootItems.push(relevantItemMap[itemId]);
    }
  });

  return { rootItems, itemMap: relevantItemMap };
}
