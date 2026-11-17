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
  return notionIdsIn(reference)
    .map((id) => links.pages[id])
    .find((page) => page !== undefined);
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
