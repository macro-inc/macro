import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
import {
  type ConversationFilterCategory,
  type ConversationFilters,
  type ConversationGrouping,
  EMPTY_CONVERSATION_FILTERS,
} from '../core/conversation-filters';
import type { ConversationSort } from '../core/conversation-list';

type ConversationListViewState = {
  filters: ConversationFilters;
  grouping: ConversationGrouping;
  sort: ConversationSort;
};

const DEFAULT_VIEW: ConversationListViewState = {
  filters: EMPTY_CONVERSATION_FILTERS,
  grouping: 'status',
  sort: 'updated',
};

const SORTS: readonly ConversationSort[] = ['updated', 'created'];
// Retained only for the old phone composition; the desktop ignores grouping.
// A saved grouping this build no longer offers (Type) falls back to the default.
const LEGACY_GROUPINGS: readonly ConversationGrouping[] = ['none', 'status'];

function stringsOf<Value extends string>(
  value: unknown,
  allowed: readonly Value[]
): Value[] {
  if (!Array.isArray(value)) return [];
  return allowed.filter((option) => value.includes(option));
}

function parseView(raw: string | null): ConversationListViewState | undefined {
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const view = parsed as {
    filters?: Record<string, unknown>;
    sort?: unknown;
    grouping?: unknown;
  };
  const sort = SORTS.find((option) => option === view.sort);
  return {
    grouping:
      LEGACY_GROUPINGS.find((option) => option === view.grouping) ??
      DEFAULT_VIEW.grouping,
    sort: sort ?? DEFAULT_VIEW.sort,
    filters: {
      type: stringsOf(view.filters?.type, ['chat', 'code'] as const),
      status: stringsOf(view.filters?.status, [
        'waiting',
        'working',
        'unread',
        'idle',
      ] as const),
      pullRequest: stringsOf(view.filters?.pullRequest, [
        'open',
        'draft',
        'merged',
        'closed',
        'none',
      ] as const),
    },
  };
}

/** The Agents sidebar's filters and sort, remembered per user. */
export function createConversationListView(userId: string | undefined) {
  const storage = createUserScopedStorage('agents-conversation-list-view-v1');
  const [view, setView] = makePersistedState(
    createSignal<ConversationListViewState>(DEFAULT_VIEW),
    {
      storages: {
        restore: () => (userId ? parseView(storage.read(userId)) : undefined),
        write: (value) => {
          if (userId) storage.write(userId, JSON.stringify(value));
        },
      },
    }
  );
  const setSelected = <Category extends ConversationFilterCategory>(
    category: Category,
    value: ConversationFilters[Category][number],
    selected: boolean
  ) => {
    const current = view().filters[category] as string[];
    const next = selected
      ? [...new Set([...current, value])]
      : current.filter((existing) => existing !== value);
    setView({
      ...view(),
      filters: { ...view().filters, [category]: next },
    });
  };
  return {
    filters: () => view().filters,
    grouping: () => view().grouping,
    sort: () => view().sort,
    setSort: (sort: ConversationSort) => setView({ ...view(), sort }),
    setSelected,
    setGrouping: (grouping: ConversationGrouping) =>
      setView({ ...view(), grouping }),
    clear: () => setView({ ...view(), filters: EMPTY_CONVERSATION_FILTERS }),
  };
}
