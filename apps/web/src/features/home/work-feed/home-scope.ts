import type { HomeTypeFilter } from '../types';
import type { WorkFeedItemType, WorkFeedScope } from './core/work-feed';

/** Item kinds each Home type filter selects. Documents and tasks share the
 * document kind; the client-side facet tells them apart. */
const ITEM_TYPES: Record<HomeTypeFilter, WorkFeedItemType[]> = {
  documents: ['document'],
  tasks: ['document'],
  email: ['email'],
  channels: ['channel', 'channel_thread'],
  chats: ['chat'],
  agents: ['agent_session'],
  projects: ['project'],
  github: ['pull_request'],
  calendar: ['calendar_event'],
};

const ALL_ITEM_TYPES: WorkFeedItemType[] = [
  'document',
  'chat',
  'project',
  'email',
  'channel',
  'channel_thread',
  'calendar_event',
  'pull_request',
  'agent_session',
];

export type HomeWorkFeedCapabilities = {
  calendar: boolean;
  foreignEntities: boolean;
  snippets: boolean;
};

const isHomeTypeFilter = (value: string): value is HomeTypeFilter =>
  value in ITEM_TYPES;

/**
 * The work feed scope for desktop Home Signal: outstanding attention plus
 * recent own work, narrowed by the selected type filters and the kinds this
 * client can show. Returns `undefined` when nothing can match.
 */
export function homeWorkFeedScope(
  typeFilters: readonly string[] | undefined,
  capabilities: HomeWorkFeedCapabilities
): WorkFeedScope | undefined {
  const selected = (typeFilters ?? []).filter(isHomeTypeFilter);
  if ((typeFilters?.length ?? 0) > 0 && selected.length === 0) return undefined;
  const requested =
    selected.length === 0
      ? ALL_ITEM_TYPES
      : selected.flatMap((t) => ITEM_TYPES[t]);
  const types = [...new Set(requested)].filter(
    (type) =>
      (type !== 'calendar_event' || capabilities.calendar) &&
      (type !== 'pull_request' || capabilities.foreignEntities)
  );
  if (types.length === 0) return undefined;
  return {
    mode: 'work',
    // Every kind is the server's default; send the narrowed list only.
    types: types.length === ALL_ITEM_TYPES.length ? [] : types,
    includeSnippets: capabilities.snippets,
  };
}
