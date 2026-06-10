import type { ListView } from '@app/constants/list-views';

/** Base URL for the public documentation site. */
export const DOCS_BASE = 'https://docs.macro.com';

/**
 * Public documentation page for each list view. Views without an entry have no
 * docs page yet, so callers should render no link for them.
 */
export const LIST_VIEW_DOCS_URL: Partial<Record<ListView, string>> = {
  inbox: `${DOCS_BASE}/product/inbox`,
  agents: `${DOCS_BASE}/product/agents`,
  mail: `${DOCS_BASE}/product/email`,
  documents: `${DOCS_BASE}/product/docs`,
  tasks: `${DOCS_BASE}/product/tasks`,
  channels: `${DOCS_BASE}/product/channels`,
  calls: `${DOCS_BASE}/product/calls`,
  companies: `${DOCS_BASE}/product/crm`,
  folders: `${DOCS_BASE}/product/folders`,
  search: `${DOCS_BASE}/product/search`,
};
