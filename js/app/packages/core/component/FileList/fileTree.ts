import type { Item } from '@service-storage/generated/schemas/item';
import type { SetStoreFunction, Store } from 'solid-js/store';

export type FileTreeNode = {
  item: Item;
  children: Item[];
};

export type FileTree = {
  rootItems: FileTreeNode[];
  itemMap: { [key: string]: FileTreeNode };
};

// A function to set the expanded state of an individual project
export const setExpandedProject = (
  projectId: string,
  isExpanded: boolean,
  expandedProjectsStore: [
    Store<{ [key: string]: boolean }>,
    SetStoreFunction<{ [key: string]: boolean }>,
  ]
) => {
  const [_, setExpandedProjects] = expandedProjectsStore;
  setExpandedProjects((otherProjects) => ({
    ...otherProjects,
    [`${projectId}`]: isExpanded,
  }));
};
