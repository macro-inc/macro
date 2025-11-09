import { createBlockStore } from '@core/block';

// A store to hold the currently expanded projects in the explorer sidebar
export const blockExpandedProjectsStore = createBlockStore<{
  [key: string]: boolean;
}>({});

// A store to hold the expanded projects in the explorer sidebar before a search is performed
export const blockPreSearchExpandedProjectsStore = createBlockStore<{
  [key: string]: boolean;
}>({});
