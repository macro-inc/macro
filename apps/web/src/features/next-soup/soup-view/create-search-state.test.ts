import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const pool = vi.hoisted(() => vi.fn((): unknown[] => []));
vi.mock('@app/lib/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('@app/features/soup/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/features/soup/search')>()),
  useSearchContext: () => ({ entityPool: () => pool, routinePool: () => [] }),
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => ({}),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@queries/soup/search', () => ({
  useSearchSoupQuery: () => ({ isSuccess: false }),
  validateSearchServiceText: (text: string) =>
    text.replaceAll('"', '').trim().length > 0,
}));
vi.mock('@app/features/next-soup/filters/configs/', () => ({
  SOUP_FILTERS: [],
}));
vi.mock('@app/features/next-soup/soup-view/sort-options', () => ({
  SORT_CONFIGS: {
    updated_at: { id: 'updated_at', fn: () => 0 },
  },
}));
vi.mock('@core/mobile/inputModality', () => ({ isModality: () => false }));
vi.mock('@core/component/EntityIcon', () => ({ getIconConfig: vi.fn() }));

import { searchQueryParts } from '../core/search-operators';
import { createSoupState } from '../create-soup-state';
import { NIL_UUID, type QueryState } from '../filters/filter-store';
import {
  createSearchState,
  hidesLocalSearchResults,
} from './create-search-state';

afterEach(() => {
  vi.useRealTimers();
  pool.mockReset();
  pool.mockReturnValue([]);
});

function featuredIdsFor(include: QueryState['include']) {
  vi.useFakeTimers();
  pool.mockReturnValue([
    {
      data: {
        id: 'task-1',
        type: 'document',
        name: 'budget review',
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
      },
    },
  ]);
  const [text, setText] = createSignal('');
  const { search, dispose } = createRoot((dispose) => ({
    dispose,
    search: createSearchState({
      surface: () => 'search',
      soup: createSoupState(),
      filters: () => ({ include, exclude: {} }),
      assignees: () => [],
      searchText: text,
      setSearchText: setText,
    }),
  }));
  setText('budget');
  vi.advanceTimersByTime(20);
  const ids = search.featuredIds();
  dispose();
  return ids;
}

it('keeps local results when a type filter NIL-excludes the other types', () => {
  expect(
    featuredIdsFor({
      subType: ['task'],
      channelId: [NIL_UUID],
      threadId: [NIL_UUID],
      chatId: [NIL_UUID],
    })
  ).toEqual(['task-1']);
});

it('hides local results from a search scoped to a channel or a sender', () => {
  expect(featuredIdsFor({ channelId: ['channel-1'] })).toEqual([]);
  expect(featuredIdsFor({ channelSenderId: ['user-1'] })).toEqual([]);
});

it('hides local results the Search view task facets cannot be tested against', () => {
  const status = {
    properties: [
      { propertyId: 'status', type: 'select' as const, value: 'done' },
    ],
  };
  expect(hidesLocalSearchResults(status, 'search')).toBe(true);
  expect(
    hidesLocalSearchResults({ documentOwnerId: ['user-1'] }, 'search')
  ).toBe(true);
  expect(
    hidesLocalSearchResults({ documentOwnerId: [NIL_UUID] }, 'search')
  ).toBe(false);
  expect(hidesLocalSearchResults({}, 'search')).toBe(false);
});

it('keeps local results in views whose tab presets carry those filters', () => {
  expect(
    hidesLocalSearchResults({ documentOwnerId: ['viewer'] }, 'documents')
  ).toBe(false);
  expect(
    hidesLocalSearchResults(
      {
        properties: [{ propertyId: 'assignee', type: 'entity', value: 'me' }],
      },
      'tasks'
    )
  ).toBe(false);
});

function featuredIdsForQuery(options: {
  nameText: string;
  operatorIndexes?: string[];
}) {
  vi.useFakeTimers();
  pool.mockReturnValue([
    {
      data: {
        id: 'task-1',
        type: 'document',
        name: 'budget review',
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
      },
    },
  ]);
  const [text, setText] = createSignal('');
  const { search, dispose } = createRoot((dispose) => ({
    dispose,
    search: createSearchState({
      surface: () => 'search',
      soup: createSoupState(),
      filters: () => ({ include: {}, exclude: {} }),
      assignees: () => [],
      searchText: text,
      setSearchText: setText,
      nameText: () => options.nameText,
      operatorIndexes: () => options.operatorIndexes,
    }),
  }));
  setText(`type:task ${options.nameText}`);
  vi.advanceTimersByTime(20);
  const ids = search.featuredIds();
  dispose();
  return ids;
}

it('matches names with the words beside the operators', () => {
  expect(featuredIdsForQuery({ nameText: 'budget' })).toEqual(['task-1']);
  expect(featuredIdsForQuery({ nameText: '' })).toEqual([]);
});

it('narrows name matches to the types the operators leave', () => {
  expect(
    featuredIdsForQuery({ nameText: 'budget', operatorIndexes: ['email'] })
  ).toEqual([]);
});

it('leaves out name matches that hold a word a minus leaves out', () => {
  vi.useFakeTimers();
  const task = (id: string, name: string) => ({
    data: {
      id,
      type: 'document',
      name,
      fileType: 'md',
      subType: { type: 'task', is_completed: false },
    },
  });
  pool.mockReturnValue([
    task('task-1', 'Budget Review'),
    task('task-2', 'budget plan'),
  ]);
  const [text, setText] = createSignal('');
  const parts = () => searchQueryParts(text());
  const { search, dispose } = createRoot((dispose) => ({
    dispose,
    search: createSearchState({
      surface: () => 'search',
      soup: createSoupState(),
      filters: () => ({ include: {}, exclude: {} }),
      assignees: () => [],
      searchText: text,
      setSearchText: setText,
      serviceText: () => parts().serviceText,
      nameText: () => parts().nameText,
      leftOutWords: () => parts().leftOutWords,
    }),
  }));

  setText('budget -REVIEW');
  vi.advanceTimersByTime(20);

  expect(search.featuredIds()).toEqual(['task-2']);
  dispose();
});
