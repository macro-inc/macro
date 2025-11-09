import { createBlockSignal } from '@core/block';

/**
 * Block-scoped signal to trigger front matter refresh when properties change in the properties panel
 * This is one-way: MarkdownPropertiesModal -> FrontMatterProperties
 * Each document/block has its own refresh trigger
 * Set to true to trigger a refetch, will be reset to false after refetching
 */
export const propertiesRefreshSignal = createBlockSignal(false);
