export const viewTypes = ['flatList', 'treeList', 'grid', 'column'] as const;

export type ViewType = (typeof viewTypes)[number];
