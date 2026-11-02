import type { HomeTypeFilter } from '../types';
import type {
  WorkFeedItemType,
  WorkFeedPageState,
  WorkFeedScope,
} from './core/work-feed';

/** Item kinds each Home type filter selects. */
const ITEM_TYPES: Record<HomeTypeFilter, WorkFeedItemType[]> = {
  documents: ['document'],
  tasks: ['task'],
  email: ['email'],
  channels: ['channel', 'channel_thread'],
  agents: ['agent_session', 'chat'],
  folders: ['project'],
  initiatives: ['initiative'],
  github: ['pull_request'],
  calendar: ['calendar_event'],
};

const ALL_ITEM_TYPES: WorkFeedItemType[] = [
  'document',
  'task',
  'chat',
  'project',
  'initiative',
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

/** The page state Home's read filter selects; without one, every state. */
export function homeWorkFeedPageState(
  readFilters: readonly string[] | undefined
): WorkFeedPageState | undefined {
  const filter = readFilters?.[0];
  if (filter === 'unread') return 'unseen';
  if (filter === 'read') return 'seen';
  return undefined;
}
