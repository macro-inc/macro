export type SoupTypename =
  | 'GraphqlSoupDocument'
  | 'GraphqlSoupChat'
  | 'GraphqlSoupProject'
  | 'GraphqlSoupEmailThread'
  | 'GraphqlSoupChannel'
  | 'GraphqlSoupChannelMessage'
  | 'GraphqlSoupCall'
  | 'GraphqlSoupCalendarEvent'
  | 'GraphqlSoupForeignEntity';

export type SoupItem = {
  id: string;
  __typename?: SoupTypename | string;
  displayName?: string | null;
  name?: string | null;
  title?: string | null;
  snippet?: string | null;
  content?: string | null;
  fileType?: string | null;
  subType?: { __typename?: string } | null;
  channelId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asItem(value: unknown): SoupItem | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  return value as SoupItem;
}

/** Walk GraphQL pages (`soup` or aliases) and collect unique items. */
export function collectSoupItems(data: unknown): SoupItem[] {
  if (!isRecord(data)) return [];
  const seen = new Set<string>();
  const items: SoupItem[] = [];
  for (const value of Object.values(data)) {
    if (!isRecord(value) || !Array.isArray(value.items)) continue;
    for (const raw of value.items) {
      const item = asItem(raw);
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  return items;
}

export function documentBlockType(item: SoupItem): string {
  switch (item.subType?.__typename) {
    case 'GraphqlTaskSubType':
      return 'task';
    case 'GraphqlSnippetSubType':
      return 'snippet';
    case 'GraphqlSkillSubType':
      return 'skill';
    default:
      return item.fileType ?? 'unknown';
  }
}

export function itemTitle(item: SoupItem): string {
  return (
    item.displayName ||
    item.name ||
    item.title ||
    item.snippet ||
    item.content ||
    'Item'
  );
}

export function queryPreview(query: string): string {
  const compact = query.replace(/\s+/g, ' ').trim();
  if (compact.length <= 72) return compact;
  return `${compact.slice(0, 71)}…`;
}
