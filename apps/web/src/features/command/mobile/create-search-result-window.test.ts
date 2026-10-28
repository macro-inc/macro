import type { EntryState } from '@components/app/split-layout/layoutManager';
import { batch, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EntitySearchCategory } from '../queries/entity-search';
import { createSearchResultWindow } from './create-search-result-window';

const history = vi.hoisted(() => ({
  state: undefined as EntryState | undefined,
  captors: new Map<string, () => unknown>(),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      currentEntryState: () => history.state,
      registerEntryStateCaptor: (key: string, read: () => unknown) => {
        history.captors.set(key, read);
        return () => history.captors.delete(key);
      },
    },
  }),
}));

type Row = { id: string; name: string };
const original: Row[] = [
  { id: 'a', name: 'First' },
  { id: 'b', name: 'Second' },
  { id: 'c', name: 'Third' },
];
const cleanups: (() => void)[] = [];
beforeEach(() => {
  history.state = undefined;
  history.captors.clear();
});
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose();
});

function setup(items: Row[], initial: { accountId?: string } = {}) {
  return createRoot((dispose) => {
    cleanups.push(dispose);
    const [accountId, setAccountId] = createSignal(
      initial.accountId ?? 'alice'
    );
    const [query, setQuery] = createSignal('notes');
    const [category, setCategory] = createSignal<EntitySearchCategory>('all');
    const [incoming, setItems] = createSignal(items);
    const [discard, setDiscard] = createSignal(false);
    const results = createSearchResultWindow({
      key: 'results',
      accountId,
      query,
      category,
      items: incoming,
      discard,
    });
    return {
      results,
      dispose,
      setAccountId,
      setQuery,
      setCategory,
      setItems,
      setDiscard,
    };
  });
}

it('ranks live until opening, then updates rows in place and appends later results', () => {
  const { results, setItems } = setup(original);
  setItems([original[2], original[1], original[0]]);
  expect(results.items().map((row) => row.id)).toEqual(['c', 'b', 'a']);
  results.preserveOrder();
  const updated = { id: 'c', name: 'Third, recently opened' };
  setItems([original[0], original[1], updated]);
  expect(results.items()).toEqual([updated, original[1], original[0]]);
  const added = { id: 'd', name: 'Next page' };
  setItems([added, original[0], original[1], updated]);
  expect(results.items()).toEqual([updated, original[1], original[0], added]);
  setItems([added, original[0], updated]);
  expect(results.items()).toEqual([updated, original[0], added]);
});

it('saves only bounded IDs and restores order using current source rows', () => {
  const first = setup(original);
  history.state = Object.fromEntries(
    [...history.captors].map(([key, read]) => [key, read()])
  );
  expect(history.state).toEqual({
    results: {
      accountId: 'alice',
      query: 'notes',
      category: 'all',
      ids: ['a', 'b', 'c'],
    },
  });
  first.dispose();
  const updated = { id: 'c', name: 'Current third' };
  const second = setup([updated]);
  expect(second.results.items()).toEqual([updated]);
  second.setItems([updated, original[1], original[0]]);
  expect(second.results.items()).toEqual([original[0], original[1], updated]);
  second.setItems([]);
  expect(second.results.items()).toEqual([]);
});

it('bounds saved ordering hints even after loading a large search', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: `row-${i}`,
    name: 'Large payload',
  }));
  setup(rows);
  expect(history.captors.get('results')?.()).toEqual({
    accountId: 'alice',
    query: 'notes',
    category: 'all',
    ids: rows.slice(0, 200).map((row) => row.id),
  });
});

it('preserves the mounted list when history is captured outside a result opener', () => {
  const { results, setItems } = setup(original);
  history.state = Object.fromEntries(
    [...history.captors].map(([key, read]) => [key, read()])
  );
  setItems([original[2], original[0], original[1]]);
  expect(results.items()).toEqual(original);
});

it('ranks new queries and categories afresh, including revisiting an earlier query', () => {
  const { results, setItems, setQuery, setCategory } = setup(original);
  results.preserveOrder();
  setItems([original[2], original[1], original[0]]);
  expect(results.items()).toEqual(original);
  setQuery('different');
  expect(results.items().map((row) => row.id)).toEqual(['c', 'b', 'a']);
  setItems(original);
  expect(results.items()).toEqual(original);
  batch(() => {
    setCategory('email');
    setItems([original[2], original[0], original[1]]);
  });
  expect(results.items().map((row) => row.id)).toEqual(['c', 'a', 'b']);
  batch(() => {
    setQuery('notes');
    setCategory('all');
    setItems([original[1], original[0], original[2]]);
  });
  expect(results.items().map((row) => row.id)).toEqual(['b', 'a', 'c']);
  setItems(original);
  expect(results.items()).toEqual(original);
});

it('uses current rows after authoritative failure and successful empty results', () => {
  const { results, setItems, setDiscard } = setup(original);
  results.preserveOrder();
  batch(() => {
    setItems([original[2]]);
  });
  expect(results.items()).toEqual([original[2]]);
  setDiscard(true);
  expect(results.items()).toEqual([original[2]]);
  batch(() => {
    setDiscard(false);
    setItems([]);
  });
  expect(results.items()).toEqual([]);
});

it('drops the previous account window while the next account is loading', () => {
  const { results, setAccountId, setItems } = setup(original);
  results.preserveOrder();
  batch(() => {
    setAccountId('bob');
    setItems([]);
  });
  expect(results.items()).toEqual([]);
  batch(() => {
    setItems([original[2], original[0]]);
  });
  expect(results.items()).toEqual([original[2], original[0]]);
});

it('ignores another account snapshot when remounting a history entry', () => {
  const first = setup(original);
  history.state = Object.fromEntries(
    [...history.captors].map(([key, read]) => [key, read()])
  );
  first.dispose();
  const { results, setItems } = setup([], {
    accountId: 'bob',
  });
  expect(results.items()).toEqual([]);
  batch(() => {
    setItems([original[2], original[0]]);
  });
  expect(results.items()).toEqual([original[2], original[0]]);
});
