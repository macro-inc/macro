import type { ListView } from '@app/constants/list-views';

/** Base URL for the public documentation site. */
export const DOCS_BASE = 'https://docs.macro.com';

/** The operators Mail's search reads, on the Search page. */
export const EMAIL_SEARCH_DOCS_URL = `${DOCS_BASE}/product/search#search-mail`;

/** The operators the Search view reads, on the Search page. */
export const SEARCH_OPERATORS_DOCS_URL = `${DOCS_BASE}/product/search#search-operators`;

/** Task projects have their own collection rather than a legacy ListView. */
export const PROJECTS_DOCS_URL = `${DOCS_BASE}/product/projects`;

/**
 * Public documentation page for each list view. Views without an entry have no
 * docs page yet, so callers should render no link for them.
 */
export const LIST_VIEW_DOCS_URL: Partial<Record<ListView, string>> = {
  home: `${DOCS_BASE}/product/home`,
  agents: `${DOCS_BASE}/product/agents`,
  mail: `${DOCS_BASE}/product/email`,
  documents: `${DOCS_BASE}/product/docs`,
  tasks: `${DOCS_BASE}/product/tasks`,
  channels: `${DOCS_BASE}/product/channels`,
  calls: `${DOCS_BASE}/product/calls`,
  companies: `${DOCS_BASE}/product/crm`,
  folders: `${DOCS_BASE}/product/drive`,
  search: `${DOCS_BASE}/product/search`,
};
