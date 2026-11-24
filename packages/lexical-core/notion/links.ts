import type { SerializedLexicalNode } from 'lexical';

/**
 * What a Notion import already knows about the objects a page refers to:
 * the Macro documents its pages became, its database placements, and its users.
 * Page/user keys and database container IDs use dashless, lowercase Notion ids.
 */
export type NotionLinks = {
  pages: Record<string, NotionPageLink>;
  users: Record<string, NotionUserLink>;
  /** Page-local placements, counted per container in body order. */
  databases?: NotionDatabaseOccurrence[];
};

/** The Macro document a Notion page became. */
export type NotionPageLink = {
  documentId: string;
  name: string;
};

/** The Macro user a Notion person is. */
export type NotionUserLink = {
  userId: string;
  email: string;
};

const NOTION_ID =
  /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;
const EXACT_ID =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const PATH_ID =
  /(?:^|-)([0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
const NOTION_HOSTS = new Set(['notion.so', 'www.notion.so']);

/** An exact source page or container, optionally with a specific view. */
export type NotionReference = { id: string; viewId?: string };

function normalizeId(value: string): string | undefined {
  if (EXACT_ID.test(value)) return value.replaceAll('-', '').toLowerCase();
}

function notionUrl(reference: string): URL | undefined {
  try {
    const url = new URL(reference);
    if (
      url.protocol === 'https:' &&
      NOTION_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port
    ) {
      return url;
    }
  } catch {
    // A malformed reference keeps its original representation.
  }
}

function referenceQuery(url: URL) {
  const pages = url.searchParams.getAll('p');
  const views = url.searchParams.getAll('v');
  if (pages.length > 1 || views.length > 1) return;
  for (const [key, value] of url.searchParams) {
    if (key === 'p' || key === 'v') continue;
    if (key !== 'pvs' || !/^\d+$/.test(value)) return;
  }
  const pageId = normalizeId(pages[0] ?? '');
  const viewId = normalizeId(views[0] ?? '');
  if ((pages.length && !pageId) || (views.length && !viewId)) return;
  return { pageId, viewId };
}

/** Parse a supported Notion link without guessing the destination from a substring. */
export function parseNotionReference(
  reference: string
): NotionReference | undefined {
  const url = notionUrl(reference);
  if (!url || reference.includes('#')) return;
  const query = referenceQuery(url);
  if (!query) return;
  const leaf = url.pathname.replace(/\/$/, '').split('/').pop() ?? '';
  const pathId = normalizeId(PATH_ID.exec(leaf)?.[1] ?? '');
  if (query.pageId && pathId && query.pageId !== pathId) return;

  const id = query.pageId ?? pathId;
  if (id) return query.viewId ? { id, viewId: query.viewId } : { id };
}

/**
 * Every Notion id in `reference` (a URL like
 * `https://www.notion.so/Plan-3fb6…#9a1c…`, `user://…`, or a bare id), last
 * first: a block anchor names the block itself, which is what an unknown or
 * child-page placeholder refers to.
 */
export function notionIdsIn(reference: string): string[] {
  return [...reference.matchAll(NOTION_ID)]
    .map((match) => match[0].replaceAll('-', '').toLowerCase())
    .reverse();
}

export function findNotionPage(
  links: NotionLinks,
  reference: string
): NotionPageLink | undefined {
  const target = parseNotionReference(reference);
  if (target && !target.viewId) return links.pages[target.id];
}

/** Notion represents a child page as a block with the child's exact page id. */
export function findNotionChildPage(
  links: NotionLinks,
  reference: string
): NotionPageLink | undefined {
  const url = notionUrl(reference);
  const id = normalizeId(url?.hash.slice(1) ?? '');
  if (id) return links.pages[id];
}

function hasLinkUrl(
  node: SerializedLexicalNode
): node is SerializedLexicalNode & { url: string } {
  return (
    (node.type === 'link' || node.type === 'autolink') &&
    'url' in node &&
    typeof node.url === 'string'
  );
}

/** Visit serialized hyperlinks, preserving all non-link nodes and attributes. */
export function visitNotionLinks(
  node: SerializedLexicalNode,
  visit: (link: { url: string }, reference: NotionReference) => void
): void {
  if (node.type === 'code' || node.type === 'custom-code') return;
  if (hasLinkUrl(node)) {
    const target = parseNotionReference(node.url);
    if (target) visit(node, target);
  }
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) visitNotionLinks(child, visit);
  }
}

export function findNotionUser(
  links: NotionLinks,
  reference: string
): NotionUserLink | undefined {
  return notionIdsIn(reference)
    .map((id) => links.users[id])
    .find((user) => user !== undefined);
}

/** Why an occurrence remains a named link back to Notion. */
export type NotionDatabaseFallbackReason =
  | 'noAccess'
  | 'notFound'
  | 'notImported'
  | 'unresolved';

/** A resolved database placement or an explicit import loss. */
export type NotionDatabaseOccurrence = {
  containerId: string;
  ordinal: number;
  target:
    | { databaseId: string; tableId: string; viewId?: string }
    | { reason: NotionDatabaseFallbackReason };
};
